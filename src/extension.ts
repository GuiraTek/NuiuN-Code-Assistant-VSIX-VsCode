import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import { Groq } from 'groq-sdk';
import { ChatViewProvider } from './chatView';
import { WriteViewProvider } from './writeView';
import { SettingsViewProvider } from './settingsView';

dotenv.config();

let groqClient: Groq | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function initializeGroqClient(): Promise<void> {
    const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
    const apiKey = config.get<string>('groqApiKey') || process.env.GROQ_API_KEY;
    
    if (!apiKey) {
        groqClient = null;
        return;
    }

    try {
        groqClient = new Groq({ apiKey });
        retryCount = 0;
    } catch (error) {
        console.error('Error initializing Groq client:', error);
        groqClient = null;
        throw error;
    }
}

async function ensureGroqClient(): Promise<boolean> {
    if (!groqClient) {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        if (!config.get<string>('groqApiKey') && !process.env.GROQ_API_KEY) {
            vscode.window.showErrorMessage('Please set your Groq API key in settings');
            vscode.commands.executeCommand('workbench.view.extension.nuiun-assistant');
            return false;
        }
        await initializeGroqClient();
        return !!groqClient;
    }
    return true;
}

async function makeGroqRequest(action: () => Promise<any>): Promise<any> {
    if (!await ensureGroqClient()) {
        return;
    }

    try {
        return await action();
    } catch (error: any) {
        console.error('Error making Groq request:', error);

        if (error.response?.status === 503) {
            vscode.window.showErrorMessage('Service temporarily unavailable. Trying again...');
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return makeGroqRequest(action);
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            vscode.window.showErrorMessage('Connection error. Checking connection...');
            await initializeGroqClient();
            return makeGroqRequest(action);
        }

        vscode.window.showErrorMessage(`Request error: ${error.message}`);
        throw error;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('NuiuN Code Assistant is now active!');

    // Initialize Groq client
    const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
    const apiKey = config.get<string>('groqApiKey') || process.env.GROQ_API_KEY;
    if (apiKey) {
        try {
            groqClient = new Groq({ apiKey });
        } catch (error) {
            console.error('Error initializing Groq client:', error);
        }
    }

    // Register Chat View Provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri, groqClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );

    // Cria e registra o WriteViewProvider
    let writeViewProvider: WriteViewProvider;
    writeViewProvider = new WriteViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            WriteViewProvider.viewType,
            writeViewProvider
        )
    );

    // Registra o comando para alternar o modo de escrita
    context.subscriptions.push(
        vscode.commands.registerCommand('nuiun-code-assistant.toggleWriteMode', () => {
            console.log('Toggle write mode command triggered');
            writeViewProvider.toggleWriteMode();
        })
    );

    // Register Settings View Provider
    const settingsViewProvider = new SettingsViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsViewProvider)
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async e => {
            if (e.affectsConfiguration('nuiun-code-assistant')) {
                await initializeGroqClient();
                if (groqClient) {
                    chatViewProvider.updateGroqClient(groqClient);
                    writeViewProvider.updateGroqClient(groqClient);
                }
            }
        })
    );
}

export function deactivate() {
}
