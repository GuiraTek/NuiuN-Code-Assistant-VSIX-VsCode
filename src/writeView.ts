import * as vscode from 'vscode';
import { Groq } from 'groq-sdk';
import * as fs from 'fs';
import * as path from 'path';

export class WriteViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nuiun-chat.writeView';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _extensionPath: string;
    private _messageHistory: { role: string; content: string }[] = [];
    private _groqClient: any;
    private _historyFile: string;
    private _writeMode: boolean = false;
    private _statusBarItem: vscode.StatusBarItem;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._writeMode = false;
        this._messageHistory = [];
        this._extensionUri = _context.extensionUri;
        this._extensionPath = _context.extensionPath;
        this._historyFile = path.join(_context.extensionPath, 'chat-history.json');
        
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.command = 'nuiun-code-assistant.toggleWriteMode';
        this._updateStatusBarItem();
        this._statusBarItem.show();

        // Carrega o histórico
        this._loadHistory();
    }

    public toggleWriteMode(): void {
        this._writeMode = !this._writeMode;
        this._updateStatusBarItem();
        
        // Notifica o webview sobre a mudança do modo
        if (this._view) {
            this._view.webview.postMessage({ 
                type: 'writeModeChanged',
                enabled: this._writeMode
            });
        }
    }

    private async _initializeGroqClient() {
        if (!this._groqClient) {
            const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
            const apiKey = config.get<string>('groqApiKey');
            
            if (apiKey) {
                this._groqClient = new Groq({
                    apiKey: apiKey
                });
            }
        }
    }

    private async _saveHistory(): Promise<void> {
        try {
            await fs.promises.writeFile(
                this._historyFile,
                JSON.stringify(this._messageHistory, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving history:', error);
            vscode.window.showErrorMessage('Failed to save chat history');
        }
    }

    private async _loadHistory(): Promise<void> {
        try {
            if (fs.existsSync(this._historyFile)) {
                const data = await fs.promises.readFile(this._historyFile, 'utf8');
                this._messageHistory = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading history:', error);
            this._messageHistory = [];
            vscode.window.showErrorMessage('Failed to load chat history');
        }
    }

    private async _clearHistory(): Promise<void> {
        this._messageHistory = [];
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        await this._saveHistory();
    }

    private async _handleMessage(message: any) {
        try {
            switch (message.type) {
                case 'sendMessage': {
                    const userMessage = message.content;
                    
                    // Adiciona mensagem do usuário ao histórico
                    this._messageHistory.push({ role: 'user', content: userMessage });
                    this._view?.webview.postMessage({
                        type: 'addMessage',
                        role: 'user',
                        content: this._escapeHtml(userMessage)
                    });

                    try {
                        // Obtém resposta do AI
                        const aiResponse = await this._getAIResponse(userMessage);
                        
                        // Se estiver no modo write, processa a estrutura de arquivos
                        if (this._writeMode) {
                            try {
                                // Verifica se a resposta contém estrutura de arquivos
                                if (!aiResponse.includes('📁') && !aiResponse.includes('📄')) {
                                    throw new Error(
                                        this._currentLanguage === 'pt_BR'
                                            ? 'Por favor, especifique a estrutura de arquivos usando 📁 para pastas e 📄 para arquivos.'
                                            : 'Please specify the file structure using 📁 for folders and 📄 for files.'
                                    );
                                }

                                // Processa a estrutura de arquivos
                                const result = await this._processCodeBlocks(aiResponse);
                                
                                // Adiciona resposta ao histórico
                                this._messageHistory.push({ role: 'assistant', content: result.formattedResponse });
                                this._view?.webview.postMessage({
                                    type: 'addMessage',
                                    role: 'assistant',
                                    content: this._formatMarkdown(result.formattedResponse)
                                });
                            } catch (error: any) {
                                // Se houver erro no processamento, envia mensagem de erro
                                const errorMessage = 
                                    this._currentLanguage === 'pt_BR'
                                        ? `Erro ao processar estrutura de arquivos: ${error.message}`
                                        : `Error processing file structure: ${error.message}`;
                                
                                this._view?.webview.postMessage({
                                    type: 'addMessage',
                                    role: 'assistant',
                                    content: this._formatMarkdown(errorMessage)
                                });
                            }
                        } else {
                            // Modo normal: apenas formata e envia a resposta
                            this._messageHistory.push({ role: 'assistant', content: aiResponse });
                            this._view?.webview.postMessage({
                                type: 'addMessage',
                                role: 'assistant',
                                content: this._formatMarkdown(aiResponse)
                            });
                        }
                    } catch (error: any) {
                        console.error('Error getting AI response:', error);
                        const errorMessage = 
                            this._currentLanguage === 'pt_BR'
                                ? `Erro ao obter resposta: ${error.message}`
                                : `Error getting response: ${error.message}`;
                        
                        this._view?.webview.postMessage({
                            type: 'addMessage',
                            role: 'assistant',
                            content: this._formatMarkdown(errorMessage)
                        });
                    }
                    break;
                }
                case 'clearHistory':
                    this._messageHistory = [];
                    this._view?.webview.postMessage({ type: 'clearChat' });
                    break;
            }
        } catch (error: any) {
            console.error('Error handling message:', error);
            vscode.window.showErrorMessage(
                this._currentLanguage === 'pt_BR'
                    ? `Erro ao processar mensagem: ${error.message}`
                    : `Error processing message: ${error.message}`
            );
        }
    }

    private async _getAIResponse(message: string): Promise<string> {
        try {
            await this._initializeGroqClient();
            if (!this._groqClient) {
                throw new Error('Groq client not initialized');
            }

            const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
            const currentLanguage = config.get<string>('language') || 'en';
            
            const systemPrompt = currentLanguage === 'pt_BR' 
                ? `Você é um assistente especializado em desenvolvimento de software.
                   Se estiver no modo de escrita (write mode), use SEMPRE os emojis 📁 para pastas e 📄 para arquivos ao criar estruturas.
                   Formate SEMPRE suas respostas usando markdown para melhor legibilidade.
                   Use SEMPRE blocos de código com a linguagem específica quando mostrar exemplos.
                   Por exemplo:
                   \`\`\`php
                   <?php
                   echo "Hello World";
                   ?>
                   \`\`\`
                   Responda SEMPRE em Português do Brasil.`
                : `You are a software development assistant.
                   If in write mode, ALWAYS use emojis 📁 for folders and 📄 for files when creating structures.
                   ALWAYS format your responses using markdown for better readability.
                   ALWAYS use code blocks with specific language when showing examples.
                   For example:
                   \`\`\`php
                   <?php
                   echo "Hello World";
                   ?>
                   \`\`\`
                   Always respond in English.`;

            const completion = await this._groqClient.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    ...this._messageHistory.slice(-5).map(msg => ({
                        role: msg.role as 'user' | 'assistant',
                        content: msg.content
                    })),
                    { role: "user", content: this._writeMode ? `[WRITE MODE ON] ${message}` : message }
                ],
                model: config.get<string>('model') || "mixtral-8x7b-32768",
                temperature: config.get<number>('temperature') || 0.7,
                max_tokens: config.get<number>('maxTokens') || 2048,
            });

            let response = completion.choices[0]?.message?.content || (
                currentLanguage === 'pt_BR' 
                    ? 'Desculpe, não consegui gerar uma resposta. Por favor, tente novamente.'
                    : 'Sorry, I could not generate a response. Please try again.'
            );

            // Processa a resposta
            if (this._writeMode) {
                const result = await this._processCodeBlocks(response);
                response = result.formattedResponse;
            } else {
                response = this._formatMarkdown(response);
            }

            return response;

        } catch (error: any) {
            console.error('Error getting AI response:', error);
            const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
            const currentLanguage = config.get<string>('language') || 'en';
            throw new Error(
                currentLanguage === 'pt_BR'
                    ? `Erro ao obter resposta: ${error.message}`
                    : `Error getting response: ${error.message}`
            );
        }
    }

    private _formatMarkdown(text: string): string {
        // Garante que blocos de código tenham linguagem especificada
        return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'plaintext';
            return `\`\`\`${language}\n${code.trim()}\`\`\``;
        });
    }

    private async _processCodeBlocks(response: string): Promise<{ formattedResponse: string }> {
        try {
            const workspaces = vscode.workspace.workspaceFolders;
            if (!workspaces || workspaces.length === 0) {
                throw new Error(
                    this._currentLanguage === 'pt_BR'
                        ? 'Nenhum workspace aberto'
                        : 'No workspace open'
                );
            }

            const fileStructureRegex = /📁\s*([^\n]+)|📄\s*([^\n]+)/g;
            let match;
            const files: { path: string; content: string }[] = [];
            let currentDir = '';
            let foundStructure = false;

            while ((match = fileStructureRegex.exec(response)) !== null) {
                foundStructure = true;
                const dirName = match[1];
                const fileName = match[2];

                if (dirName) {
                    currentDir = dirName.trim();
                } else if (fileName) {
                    const filePath = path.join(currentDir, fileName.trim());
                    files.push({
                        path: filePath,
                        content: this._getTemplateContent(fileName.trim())
                    });
                }
            }

            if (!foundStructure) {
                throw new Error(
                    this._currentLanguage === 'pt_BR'
                        ? 'Nenhuma estrutura de arquivos encontrada. Use 📁 para pastas e 📄 para arquivos.'
                        : 'No file structure found. Use 📁 for folders and 📄 for files.'
                );
            }

            const workspaceRoot = workspaces[0].uri.fsPath;
            
            // Cria os arquivos
            for (const file of files) {
                const fullPath = path.join(workspaceRoot, file.path);
                const dir = path.dirname(fullPath);
                
                // Cria o diretório se não existir
                if (!fs.existsSync(dir)) {
                    await fs.promises.mkdir(dir, { recursive: true });
                }
                
                // Cria o arquivo
                await fs.promises.writeFile(fullPath, file.content, 'utf8');
                
                // Abre o arquivo no editor
                try {
                    const document = await vscode.workspace.openTextDocument(fullPath);
                    await vscode.window.showTextDocument(document, { preview: false });
                } catch (error) {
                    console.error(`Error opening file ${fullPath}:`, error);
                }
            }

            return {
                formattedResponse: this._currentLanguage === 'pt_BR'
                    ? `✅ Estrutura criada com sucesso!\n\nForam criados ${files.length} arquivos no workspace:\n${workspaceRoot}`
                    : `✅ Structure created successfully!\n\nCreated ${files.length} files in workspace:\n${workspaceRoot}`
            };

        } catch (error: any) {
            console.error('Error processing code blocks:', error);
            throw error;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const translations = this._getTranslations();
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        const currentLanguage = config.get<string>('language') || 'en';

        // Carrega o CSS do VS Code para os ícones
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
        <html lang="${currentLanguage}">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${codiconsUri}" rel="stylesheet" />
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    margin: 0;
                    padding: 16px;
                }

                .chat-container {
                    display: flex;
                    flex-direction: column;
                    height: calc(100vh - 120px);
                    overflow-y: auto;
                }

                .message {
                    margin: 8px 0;
                    padding: 12px;
                    border-radius: 6px;
                    max-width: 80%;
                    word-break: break-word;
                }

                .user-message {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    align-self: flex-end;
                }

                .assistant-message {
                    background: var(--vscode-editor-selectionBackground);
                    align-self: flex-start;
                }

                .input-container {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    padding: 16px;
                    background: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-widget-border);
                    display: flex;
                    gap: 8px;
                }

                textarea {
                    flex: 1;
                    min-height: 40px;
                    max-height: 120px;
                    padding: 8px;
                    border-radius: 4px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    font-family: inherit;
                    resize: vertical;
                }

                button {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px 16px;
                    min-width: 32px;
                    height: 32px;
                    border: none;
                    border-radius: 4px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    cursor: pointer;
                    transition: opacity 0.2s;
                }

                button:hover {
                    opacity: 0.9;
                }

                .clear-button {
                    background-color: var(--vscode-errorForeground) !important;
                }

                .button-icon {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    margin: 0;
                    padding: 0;
                }

                /* Estilos para markdown */
                .markdown-body {
                    color: var(--vscode-editor-foreground);
                }

                .markdown-body pre {
                    background: var(--vscode-textBlockQuote-background);
                    padding: 16px;
                    border-radius: 6px;
                    overflow-x: auto;
                }

                .markdown-body code {
                    font-family: var(--vscode-editor-font-family);
                    background: var(--vscode-textBlockQuote-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                }

                .markdown-body h1,
                .markdown-body h2,
                .markdown-body h3,
                .markdown-body h4,
                .markdown-body h5,
                .markdown-body h6 {
                    color: var(--vscode-editor-foreground);
                    margin-top: 24px;
                    margin-bottom: 16px;
                    font-weight: 600;
                    line-height: 1.25;
                }

                .markdown-body p {
                    margin-top: 0;
                    margin-bottom: 16px;
                }

                .markdown-body ul,
                .markdown-body ol {
                    margin-top: 0;
                    margin-bottom: 16px;
                    padding-left: 2em;
                }

                .markdown-body blockquote {
                    padding: 0 1em;
                    color: var(--vscode-textPreformat-foreground);
                    border-left: 0.25em solid var(--vscode-textBlockQuote-border);
                    margin: 0 0 16px 0;
                }
            </style>
        </head>
        <body>
            <div class="chat-container" id="chat"></div>
            <div class="input-container">
                <textarea 
                    id="messageInput" 
                    placeholder="${translations.inputPlaceholder}" 
                    rows="1"
                ></textarea>
                <button id="sendButton" title="${translations.sendButton}">
                    <svg class="button-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14.5 8l-13-6v4.5l9 1.5-9 1.5v4.5l13-6z"/>
                    </svg>
                </button>
                <button id="clearButton" class="clear-button" title="${translations.clearButton}">
                    <svg class="button-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 10.5l-1 1L8 9l-2.5 2.5-1-1L7 8 4.5 5.5l1-1L8 7l2.5-2.5 1 1L9 8l2.5 2.5z"/>
                    </svg>
                </button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const chat = document.getElementById('chat');
                const messageInput = document.getElementById('messageInput');
                const sendButton = document.getElementById('sendButton');
                const clearButton = document.getElementById('clearButton');

                // Ajusta altura do textarea automaticamente
                messageInput.addEventListener('input', () => {
                    messageInput.style.height = 'auto';
                    messageInput.style.height = messageInput.scrollHeight + 'px';
                });

                // Envio de mensagem
                function sendMessage() {
                    const content = messageInput.value.trim();
                    if (content) {
                        vscode.postMessage({ type: 'sendMessage', content });
                        messageInput.value = '';
                        messageInput.style.height = 'auto';
                    }
                }

                // Event listeners
                messageInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                    }
                });

                sendButton.addEventListener('click', sendMessage);
                clearButton.addEventListener('click', () => {
                    vscode.postMessage({ type: 'clearHistory' });
                    chat.innerHTML = '';
                });

                // Recebe mensagens do extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'addMessage':
                            const div = document.createElement('div');
                            div.className = \`message \${message.role}-message markdown-body\`;
                            div.innerHTML = message.content;
                            chat.appendChild(div);
                            div.scrollIntoView({ behavior: 'smooth' });
                            break;
                            
                        case 'clearChat':
                            chat.innerHTML = '';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private _updateStatusBarItem(): void {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        const currentLanguage = config.get<string>('language') || 'en';
        
        this._statusBarItem.text = `$(pencil) ${
            currentLanguage === 'pt_BR' ? 'Modo Escrita' : 'Write Mode'
        }: ${this._writeMode ? 'ON' : 'OFF'}`;
        
        this._statusBarItem.backgroundColor = this._writeMode ? 
            new vscode.ThemeColor('statusBarItem.warningBackground') : 
            undefined;
        
        // Mostra notificação do status atual
        vscode.window.showInformationMessage(
            currentLanguage === 'pt_BR' 
                ? `Modo de escrita ${this._writeMode ? 'ativado' : 'desativado'}`
                : `Write mode ${this._writeMode ? 'enabled' : 'disabled'}`
        );
    }

    private _toPascalCase(str: string): string {
        return str
            .split(/[^a-zA-Z0-9]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    private _getFileExtension(lang: string | undefined): string | null {
        const extensions: { [key: string]: string } = {
            'php': '.php',
            'javascript': '.js',
            'typescript': '.ts',
            'python': '.py',
            'html': '.html',
            'css': '.css',
            'json': '.json',
            'markdown': '.md',
            'yaml': '.yml',
            'dockerfile': 'Dockerfile',
            'shell': '.sh',
            'sql': '.sql'
        };

        if (!lang) return null;

        const normalizedLang = lang.toLowerCase()
            .replace('language-', '')
            .replace('text/', '');

        return extensions[normalizedLang] || null;
    }

    private _getTemplateContent(filePath: string): string {
        const fileName = path.basename(filePath);
        const dirName = path.dirname(filePath);
        const entityName = 'School'; // Poderia ser extraído do nome do arquivo

        // Templates para diferentes tipos de arquivos
        if (fileName.includes('Controller')) {
            return `<?php
namespace App\\Controller;

class SchoolController {
    private $model;

    public function __construct() {
        $this->model = new \\App\\Model\\SchoolModel();
    }

    public function index() {
        $schools = $this->model->getAll();
        require_once '../app/View/school/index.php';
    }

    public function create() {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = [
                'name' => $_POST['name'] ?? '',
                'address' => $_POST['address'] ?? '',
                // Adicione outros campos conforme necessário
            ];
            
            $this->model->create($data);
            header('Location: /school');
            exit;
        }
        
        require_once '../app/View/school/create.php';
    }

    public function update($id) {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $data = [
                'name' => $_POST['name'] ?? '',
                'address' => $_POST['address'] ?? '',
                // Adicione outros campos conforme necessário
            ];
            
            $this->model->update($id, $data);
            header('Location: /school');
            exit;
        }
        
        $school = $this->model->getById($id);
        require_once '../app/View/school/update.php';
    }

    public function delete($id) {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $this->model->delete($id);
            header('Location: /school');
            exit;
        }
        
        $school = $this->model->getById($id);
        require_once '../app/View/school/delete.php';
    }
}`;
        } else if (fileName.includes('Model')) {
            return `<?php
namespace App\\Model;

class SchoolModel {
    private $db;

    public function __construct() {
        // Inicializar conexão com o banco de dados
        $this->db = new \\PDO("mysql:host=localhost;dbname=school_db", "user", "password");
    }

    public function getAll() {
        $stmt = $this->db->query("SELECT * FROM schools");
        return $stmt->fetchAll(\\PDO::FETCH_ASSOC);
    }

    public function getById($id) {
        $stmt = $this->db->prepare("SELECT * FROM schools WHERE id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch(\\PDO::FETCH_ASSOC);
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO schools (name, address) VALUES (?, ?)");
        return $stmt->execute([$data['name'], $data['address']]);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE schools SET name = ?, address = ? WHERE id = ?");
        return $stmt->execute([$data['name'], $data['address'], $id]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM schools WHERE id = ?");
        return $stmt->execute([$id]);
    }
}`;
        } else if (fileName === 'index.php' && dirName.includes('school')) {
            return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lista de Escolas</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <div class="container">
        <h1>Lista de Escolas</h1>
        <a href="/school/create" class="btn btn-primary">Nova Escola</a>
        
        <table class="table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Endereço</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($schools as $school): ?>
                <tr>
                    <td><?= $school['id'] ?></td>
                    <td><?= htmlspecialchars($school['name']) ?></td>
                    <td><?= htmlspecialchars($school['address']) ?></td>
                    <td>
                        <a href="/school/update/<?= $school['id'] ?>" class="btn btn-sm btn-warning">Editar</a>
                        <a href="/school/delete/<?= $school['id'] ?>" class="btn btn-sm btn-danger">Excluir</a>
                    </td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <script src="/js/script.js"></script>
</body>
</html>`;
        } else if (fileName === 'create.php') {
            return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nova Escola</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <div class="container">
        <h1>Nova Escola</h1>
        
        <form action="/school/create" method="POST">
            <div class="form-group">
                <label for="name">Nome:</label>
                <input type="text" id="name" name="name" required class="form-control">
            </div>
            
            <div class="form-group">
                <label for="address">Endereço:</label>
                <input type="text" id="address" name="address" required class="form-control">
            </div>
            
            <button type="submit" class="btn btn-primary">Salvar</button>
            <a href="/school" class="btn btn-secondary">Cancelar</a>
        </form>
    </div>
    <script src="/js/script.js"></script>
</body>
</html>`;
        } else if (fileName === 'update.php') {
            return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editar Escola</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <div class="container">
        <h1>Editar Escola</h1>
        
        <form action="/school/update/<?= $school['id'] ?>" method="POST">
            <div class="form-group">
                <label for="name">Nome:</label>
                <input type="text" id="name" name="name" value="<?= htmlspecialchars($school['name']) ?>" required class="form-control">
            </div>
            
            <div class="form-group">
                <label for="address">Endereço:</label>
                <input type="text" id="address" name="address" value="<?= htmlspecialchars($school['address']) ?>" required class="form-control">
            </div>
            
            <button type="submit" class="btn btn-primary">Salvar</button>
            <a href="/school" class="btn btn-secondary">Cancelar</a>
        </form>
    </div>
    <script src="/js/script.js"></script>
</body>
</html>`;
        } else if (fileName === 'delete.php') {
            return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Excluir Escola</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <div class="container">
        <h1>Excluir Escola</h1>
        
        <div class="alert alert-danger">
            <p>Tem certeza que deseja excluir a escola "<?= htmlspecialchars($school['name']) ?>"?</p>
        </div>
        
        <form action="/school/delete/<?= $school['id'] ?>" method="POST">
            <button type="submit" class="btn btn-danger">Confirmar Exclusão</button>
            <a href="/school" class="btn btn-secondary">Cancelar</a>
        </form>
    </div>
    <script src="/js/script.js"></script>
</body>
</html>`;
        } else if (fileName === 'index.php' && dirName.includes('public')) {
            return `<?php
require_once '../vendor/autoload.php';

// Configuração de rotas
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$controller = new \\App\\Controller\\SchoolController();

switch ($uri) {
    case '/':
    case '/school':
        $controller->index();
        break;
        
    case '/school/create':
        $controller->create();
        break;
        
    case (preg_match('/^\/school\/update\/(\d+)$/', $uri, $matches) ? true : false):
        $controller->update($matches[1]);
        break;
        
    case (preg_match('/^\/school\/delete\/(\d+)$/', $uri, $matches) ? true : false):
        $controller->delete($matches[1]);
        break;
        
    default:
        header('HTTP/1.1 404 Not Found');
        echo '404 - Página não encontrada';
        break;
}`;
        }

        // Retorna um arquivo vazio para outros casos (como pastas css e js)
        return '';
    }

    private _buildFinalPath(originalPath: string, entityName: string, componentType: string): string {
        const baseDir = 'app';
        const extension = path.extname(originalPath);
        const viewName = path.basename(originalPath, extension);

        // Mapeamento de diretórios
        const dirMap: Record<string, string> = {
            'controller': path.join(baseDir, 'controllers', `${entityName}Controller${extension}`),
            'model': path.join(baseDir, 'models', `${entityName}${extension}`),
            'views': path.join(baseDir, 'views', entityName.toLowerCase(), `${viewName}${extension}`),
            'css': path.join('public', 'assets', 'css', path.basename(originalPath)),
            'js': path.join('public', 'assets', 'js', path.basename(originalPath))
        };

        return dirMap[componentType] || originalPath;
    }

    private _getComponentType(filePath: string): string {
        if (filePath.includes('controllers')) return 'controller';
        if (filePath.includes('models')) return 'model';
        if (filePath.includes('views')) return 'views';
        if (filePath.endsWith('.css')) return 'css';
        if (filePath.endsWith('.js')) return 'js';
        return '';
    }

    private _extractEntityName(filePath: string): string {
        const fileName = path.basename(filePath, path.extname(filePath));
        return this._toPascalCase(
            fileName
                .replace(/controller$/i, '')
                .replace(/model$/i, '')
                .replace(/service$/i, '')
                .replace(/repository$/i, '')
                .replace(/helper$/i, '')
                .replace(/middleware$/i, '')
                .replace(/router$/i, '')
        );
    }

    private _sortFilesByType(files: { path: string; content: string }[]): { path: string; content: string }[] {
        const typeOrder = ['model', 'controller', 'views', 'css', 'js'];
        
        return files.sort((a, b) => {
            const typeA = this._getComponentType(a.path);
            const typeB = this._getComponentType(b.path);
            
            const indexA = typeOrder.indexOf(typeA);
            const indexB = typeOrder.indexOf(typeB);
            
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            
            return indexA - indexB;
        });
    }

    private _organizeFileStructure(fileStructure: { [key: string]: string[] }): { [key: string]: any } {
        const organized: { [key: string]: any } = {};
        
        for (const [dir, files] of Object.entries(fileStructure)) {
            let current = organized;
            const parts = dir.split(path.sep);
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!current[part]) {
                    current[part] = i === parts.length - 1 ? files : {};
                }
                current = current[part];
            }
        }
        
        return organized;
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this._handleMessage(data);
                    break;
                case 'clearHistory':
                    await this._clearHistory();
                    break;
            }
        });

        return Promise.resolve();
    }

    private readonly _templates = {
        controller: (entityName: string) => `<?php
namespace App\\Controllers;

class ${entityName}Controller {
    public function index() {
        // List all items
    }

    public function show($id) {
        // Show single item
    }

    public function create() {
        // Create new item
    }

    public function store() {
        // Store new item
    }

    public function edit($id) {
        // Edit item
    }

    public function update($id) {
        // Update item
    }

    public function delete($id) {
        // Delete item
    }
}`,
        model: (entityName: string) => `<?php
namespace App\\Models;

class ${entityName} {
    protected $fillable = [
        // Add fillable fields
    ];

    protected $rules = [
        // Add validation rules
    ];
}`,
        service: (entityName: string) => `<?php
namespace App\\Services;

use App\\Models\\${entityName};

class ${entityName}Service {
    public function getAll() {
        return ${entityName}::all();
    }

    public function getById($id) {
        return ${entityName}::find($id);
    }

    public function create($data) {
        return ${entityName}::create($data);
    }

    public function update($id, $data) {
        $item = ${entityName}::find($id);
        $item->update($data);
        return $item;
    }

    public function delete($id) {
        return ${entityName}::destroy($id);
    }
}`,
        repository: (entityName: string) => `<?php
namespace App\\Repositories;

use App\\Models\\${entityName};

class ${entityName}Repository {
    protected $model;

    public function __construct(${entityName} $model) {
        $this->model = $model;
    }

    public function all() {
        return $this->model->all();
    }

    public function find($id) {
        return $this->model->find($id);
    }

    public function create($data) {
        return $this->model->create($data);
    }

    public function update($id, $data) {
        $item = $this->model->find($id);
        $item->update($data);
        return $item;
    }

    public function delete($id) {
        return $this->model->destroy($id);
    }
}`,
        route: (entityName: string) => `<?php
use App\\Controllers\\${entityName}Controller;

Route::get('/${entityName.toLowerCase()}', [${entityName}Controller::class, 'index']);
Route::get('/${entityName.toLowerCase()}/{id}', [${entityName}Controller::class, 'show']);
Route::get('/${entityName.toLowerCase()}/create', [${entityName}Controller::class, 'create']);
Route::post('/${entityName.toLowerCase()}', [${entityName}Controller::class, 'store']);
Route::get('/${entityName.toLowerCase()}/{id}/edit', [${entityName}Controller::class, 'edit']);
Route::put('/${entityName.toLowerCase()}/{id}', [${entityName}Controller::class, 'update']);
Route::delete('/${entityName.toLowerCase()}/{id}', [${entityName}Controller::class, 'delete']);`,
        views: {
            index: (entityName: string) => `<!DOCTYPE html>
<html>
    <head>
        <title>${entityName} List</title>
    </head>
    <body>
        <h1>${entityName} List</h1>
        <!-- Add list view here -->
    </body>
</html>`,
            create: (entityName: string) => `<!DOCTYPE html>
<html>
    <head>
        <title>Create ${entityName}</title>
    </head>
    <body>
        <h1>Create ${entityName}</h1>
        <!-- Add create form here -->
    </body>
</html>`,
            edit: (entityName: string) => `<!DOCTYPE html>
<html>
    <head>
        <title>Edit ${entityName}</title>
    </head>
    <body>
        <h1>Edit ${entityName}</h1>
        <!-- Add edit form here -->
    </body>
</html>`,
            show: (entityName: string) => `<!DOCTYPE html>
<html>
    <head>
        <title>${entityName} Details</title>
    </head>
    <body>
        <h1>${entityName} Details</h1>
        <!-- Add details view here -->
    </body>
</html>`,
            default: (entityName: string) => `<!DOCTYPE html>
<html>
    <head>
        <title>${entityName}</title>
    </head>
    <body>
        <h1>${entityName}</h1>
        <!-- Add content here -->
    </body>
</html>`
        },
        css: () => `/* Add your styles here */`,
        js: () => `// Add your JavaScript code here`
    };

    private async _openFile(filePath: string) {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error: any) {
            console.error(`Erro ao abrir arquivo ${filePath}:`, error);
        }
    }

    private _getTranslations(): any {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        const currentLanguage = config.get<string>('language') || 'en';

        return currentLanguage === 'pt_BR' ? {
            inputPlaceholder: 'Digite sua mensagem...',
            sendButton: 'Enviar',
            clearButton: 'Limpar Histórico',
            send: 'Enviar mensagem',
            clear: 'Limpar histórico',
            writeMode: 'Modo Escrita'
        } : {
            inputPlaceholder: 'Type your message...',
            sendButton: 'Send',
            clearButton: 'Clear History',
            send: 'Send message',
            clear: 'Clear history',
            writeMode: 'Write Mode'
        };
    }

    public updateGroqClient(groqClient: Groq) {
        console.log('Updating Groq client');
        this._groqClient = groqClient;
    }

    private get _currentLanguage(): string {
        const config = vscode.workspace.getConfiguration('nuiun-code-assistant');
        return config.get<string>('language') || 'en';
    }

    private _escapeHtml(text: string): string {
        const htmlEntities: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
    }
}
