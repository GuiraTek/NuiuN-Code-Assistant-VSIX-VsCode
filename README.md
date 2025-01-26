# NuiuN Code Assistant VSIX for VsCode

A VS Code extension that uses the Groq API to provide intelligent code assistance, suggestions, and corrections.

## Features

- **Chat Interface**: Get code help through a natural conversation interface
- **Write Mode**: Enable write mode to capture your instructions and generate code automatically
- **Multiple Models**: Choose between different Groq models for code generation
- **Customizable Settings**: Adjust temperature and token limits to control code generation

## Requirements

- VS Code 1.96.0 or higher
- Groq API key

## Installation

1. Download the `.vsix` file from the latest release
2. Install it in VS Code using the "Install from VSIX" command
3. Configure your Groq API key in the extension settings

## Configuration

Access the extension settings through:
1. The settings icon in the activity bar
2. Command Palette > "NuiuN: Open Settings"

Available settings:
- `groqApiKey`: Your Groq API key
- `model`: Choose between llama2-70b-4096, mixtral-8x7b-32768
- `temperature`: Control randomness (0-1)
- `maxTokens`: Maximum tokens per response
- `language`: Choose between English, Portuguese (Brazil), Spanish, French, German, Italian, Japanese, Korean, Chinese (Simplified), or Russian

## Usage

### Chat Interface
1. Click the NuiuN Chat icon in the activity bar
2. Type your question or request
3. Press Enter or click Send

### Write Mode
1. Open a file you want to modify
2. Start Write Mode (Command Palette > "NuiuN: Start Write Mode")
3. Type your instructions
4. Stop Write Mode to generate code

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npm run package
```

## License

Apache 2.0 License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issue tracker.
