import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { mkdirp } from 'mkdirp';
import { Groq } from 'groq-sdk';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nuiun-chat.chatView';
    private _view?: vscode.WebviewView;
    private _groqClient: Groq | null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        groqClient: Groq | null
    ) {
        this._groqClient = groqClient;
        this._initializeGroqClient();
    }

    private async _initializeGroqClient() {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        const apiKey = config.get<string>('groqApiKey') || process.env.GROQ_API_KEY;
        
        console.log('Initializing Groq client... API Key exists:', !!apiKey);
        
        if (apiKey) {
            try {
                this._groqClient = new Groq({ apiKey });
                console.log('Groq client initialized successfully');
            } catch (error: any) {
                console.error('Error initializing Groq client:', error);
                this._groqClient = null;
                vscode.window.showErrorMessage(`Failed to initialize Groq client: ${error.message}`);
            }
        } else {
            console.log('No API key found');
            this._groqClient = null;
        }
    }

    public updateGroqClient(groqClient: Groq) {
        console.log('Updating Groq client');
        this._groqClient = groqClient;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        this._updateWebview();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this._handleMessage(data.value);
                    break;
            }
        });
    }

    private async _handleMessage(message: string) {
        if (!this._view) {
            console.log('No view available');
            return;
        }

        console.log('Handling message:', message);

        try {
            await this._initializeGroqClient();

            if (!this._groqClient) {
                console.log('No Groq client available after initialization');
                this._view.webview.postMessage({
                    type: 'addMessage',
                    value: {
                        role: 'assistant',
                        content: 'Please set your Groq API key in settings first.'
                    }
                });
                vscode.commands.executeCommand('workbench.view.extension.nuiun-settings');
                return;
            }

            // Show user message
            this._view.webview.postMessage({
                type: 'addMessage',
                value: {
                    role: 'user',
                    content: message
                }
            });

            console.log('Sending request to Groq API...');
            const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
            const model = config.get<string>('model') || "llama2-70b-4096";
            const temperature = config.get<number>('temperature') || 0.7;
            const maxTokens = config.get<number>('maxTokens') || 4000;

            console.log('Using configuration:', { model, temperature, maxTokens });

            const completion = await this._groqClient.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a code assistant that helps create and modify code files and directories. When a user asks for a task, analyze it and create the necessary files and directories. Always respond with both explanations and code blocks. Format code blocks with ```language\ncode\n```.'
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                model,
                temperature,
                max_tokens: maxTokens,
                top_p: 1,
                stream: false
            });

            console.log('Received response from Groq API');

            const response = completion.choices[0]?.message?.content;
            if (response) {
                console.log('Sending response to webview');
                this._view.webview.postMessage({
                    type: 'addMessage',
                    value: {
                        role: 'assistant',
                        content: response
                    }
                });

                // Extrair blocos de código e criar arquivos
                const codeBlocks = response.match(/\`\`\`[\s\S]*?\`\`\`/g);
                if (codeBlocks) {
                    for (const block of codeBlocks) {
                        const match = block.match(/\`\`\`([\w-]+)?\n([\s\S]*?)\`\`\`/);
                        if (match) {
                            const [, language, code] = match;
                            // Procurar por comentário especial indicando o caminho do arquivo
                            const filePathMatch = code.match(/\/\/ @file: (.+)/);
                            if (filePathMatch) {
                                const filePath = filePathMatch[1].trim();
                                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                                if (workspaceFolder) {
                                    const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
                                    const directory = path.dirname(fullPath);
                                    
                                    // Criar diretório se não existir
                                    await mkdirp(directory);
                                    
                                    // Criar arquivo com o código
                                    const codeWithoutFilePath = code.replace(/\/\/ @file: .+\n/, '');
                                    fs.writeFileSync(fullPath, codeWithoutFilePath);
                                    
                                    // Abrir o arquivo no editor
                                    const document = await vscode.workspace.openTextDocument(fullPath);
                                    await vscode.window.showTextDocument(document);
                                }
                            }
                        }
                    }
                }
            } else {
                console.error('No response content from API');
                throw new Error('No response from API');
            }
        } catch (error: any) {
            console.error('Error in chat:', error);
            let errorMessage = 'An error occurred while processing your message.';
            
            if (error.response?.status === 503) {
                errorMessage = 'Service temporarily unavailable. Please try again in a few moments.';
            } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection error. Please check your internet connection.';
            } else if (error.message) {
                errorMessage = `Error: ${error.message}`;
            }

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'addMessage',
                    value: {
                        role: 'assistant',
                        content: errorMessage
                    }
                });
            }

            vscode.window.showErrorMessage(errorMessage);
        }
    }

    private _updateWebview() {
        if (!this._view) {
            return;
        }

        this._view.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 15px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .chat-container {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                    height: calc(100vh - 120px);
                }
                .messages {
                    flex-grow: 1;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .message {
                    padding: 10px;
                    border-radius: 5px;
                    max-width: 80%;
                    white-space: pre-wrap;
                }
                .user-message {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    align-self: flex-end;
                }
                .assistant-message {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-input-border);
                    align-self: flex-start;
                }
                .input-container {
                    display: flex;
                    gap: 10px;
                    padding: 10px 0;
                }
                #messageInput {
                    flex-grow: 1;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                button {
                    padding: 8px 15px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                pre {
                    background-color: var(--vscode-editor-background);
                    padding: 10px;
                    border-radius: 5px;
                    overflow-x: auto;
                    margin: 10px 0;
                }
                code {
                    font-family: var(--vscode-editor-font-family);
                }
            </style>
        </head>
        <body>
            <div class="chat-container">
                <div class="messages" id="messages"></div>
                <div class="input-container">
                    <input type="text" id="messageInput" placeholder="Type your message...">
                    <button onclick="sendMessage()">Send</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const messagesContainer = document.getElementById('messages');
                const messageInput = document.getElementById('messageInput');

                messageInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        sendMessage();
                    }
                });

                function sendMessage() {
                    const message = messageInput.value.trim();
                    if (message) {
                        vscode.postMessage({
                            type: 'sendMessage',
                            value: message
                        });
                        messageInput.value = '';
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addMessage':
                            addMessageToChat(message.value);
                            break;
                    }
                });

                function addMessageToChat(message) {
                    const messageElement = document.createElement('div');
                    messageElement.className = \`message \${message.role}-message\`;
                    
                    // Format code blocks
                    let content = message.content;
                    content = content.replace(/\`\`\`([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
                    content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
                    
                    messageElement.innerHTML = content;
                    messagesContainer.appendChild(messageElement);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            </script>
        </body>
        </html>`;
    }
}
