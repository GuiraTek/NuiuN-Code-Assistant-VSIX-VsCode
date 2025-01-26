import * as vscode from 'vscode';

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nuiun-settings.settingsView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}

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

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveSettings':
                    await this._saveSettings(data.settings);
                    break;
            }
        });
    }

    private async _updateWebview() {
        if (!this._view) {
            return;
        }

        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        const currentLanguage = config.get<string>('language') || 'en';
        const currentModel = config.get<string>('model') || 'mixtral-8x7b-32768';
        const currentTemperature = config.get<number>('temperature') || 0.7;
        const currentMaxTokens = config.get<number>('maxTokens') || 4000;
        const currentApiKey = config.get<string>('groqApiKey') || '';

        const languages = [
            { value: 'en', label: 'English' },
            { value: 'pt_BR', label: 'Português (Brasil)' },
            { value: 'es', label: 'Español' },
            { value: 'fr', label: 'Français' },
            { value: 'de', label: 'Deutsch' },
            { value: 'it', label: 'Italiano' },
            { value: 'ja', label: '日本語' },
            { value: 'ko', label: '한국어' },
            { value: 'zh_CN', label: '简体中文' },
            { value: 'ru', label: 'Русский' }
        ];

        const translations = {
            title: currentLanguage === 'pt_BR' ? 'Configurações' : 'Settings',
            apiKeyLabel: currentLanguage === 'pt_BR' ? 'Chave API do Groq:' : 'Groq API Key:',
            modelLabel: currentLanguage === 'pt_BR' ? 'Modelo:' : 'Model:',
            temperatureLabel: currentLanguage === 'pt_BR' ? 'Temperatura:' : 'Temperature:',
            maxTokensLabel: currentLanguage === 'pt_BR' ? 'Máximo de Tokens:' : 'Max Tokens:',
            languageLabel: currentLanguage === 'pt_BR' ? 'Idioma:' : 'Language:',
            saveButton: currentLanguage === 'pt_BR' ? 'Salvar' : 'Save'
        };

        this._view.webview.html = this._getHtmlForWebview(currentLanguage, currentModel, currentTemperature, currentMaxTokens, currentApiKey, languages, translations);
    }

    private _getHtmlForWebview(currentLanguage: string, currentModel: string, currentTemperature: number, currentMaxTokens: number, currentApiKey: string, languages: { value: string; label: string; }[], translations: { [key: string]: string; }) {
        return `<!DOCTYPE html>
        <html lang="${currentLanguage}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${translations.title}</title>
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                }
                input[type="text"],
                input[type="number"],
                select {
                    width: 100%;
                    padding: 5px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                button {
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    cursor: pointer;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <form id="settingsForm">
                <div class="form-group">
                    <label for="apiKey">${translations.apiKeyLabel}</label>
                    <input type="text" id="apiKey" value="${currentApiKey}">
                </div>
                <div class="form-group">
                    <label for="model">${translations.modelLabel}</label>
                    <select id="model">
                        <option value="mixtral-8x7b-32768" ${currentModel === 'mixtral-8x7b-32768' ? 'selected' : ''}>Mixtral 8x7B 32K</option>
                        <option value="llama2-70b-4096" ${currentModel === 'llama2-70b-4096' ? 'selected' : ''}>LLaMA2 70B</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="temperature">${translations.temperatureLabel}</label>
                    <input type="number" id="temperature" min="0" max="1" step="0.1" value="${currentTemperature}">
                </div>
                <div class="form-group">
                    <label for="maxTokens">${translations.maxTokensLabel}</label>
                    <input type="number" id="maxTokens" min="1" max="32768" value="${currentMaxTokens}">
                </div>
                <div class="form-group">
                    <label for="language">${translations.languageLabel}</label>
                    <select id="language">
                        ${languages.map(lang => 
                            `<option value="${lang.value}" ${currentLanguage === lang.value ? 'selected' : ''}>${lang.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <button type="submit">${translations.saveButton}</button>
            </form>

            <script>
                const vscode = acquireVsCodeApi();
                const form = document.getElementById('settingsForm');

                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const settings = {
                        groqApiKey: document.getElementById('apiKey').value,
                        model: document.getElementById('model').value,
                        temperature: parseFloat(document.getElementById('temperature').value),
                        maxTokens: parseInt(document.getElementById('maxTokens').value),
                        language: document.getElementById('language').value
                    };
                    vscode.postMessage({ type: 'saveSettings', settings });
                });
            </script>
        </body>
        </html>`;
    }

    private async _saveSettings(settings: any) {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        
        await config.update('groqApiKey', settings.groqApiKey, true);
        await config.update('model', settings.model, true);
        await config.update('temperature', settings.temperature, true);
        await config.update('maxTokens', settings.maxTokens, true);
        await config.update('language', settings.language, true);

        vscode.window.showInformationMessage('Settings saved successfully!');
        this._updateWebview();
    }
}
