import { Plugin, TFile, TFolder, Notice, PluginSettingTab, Setting, App, SuggestModal } from 'obsidian';
import { ExifParserFactory } from 'ts-exif-parser';
import * as yaml from 'js-yaml';


interface ImageToMarkdownSettings {
    useMarkdownLinks: boolean;
    yamlProperties: string;
    tags: string;
    templatePath: string;
}

const DEFAULT_SETTINGS: ImageToMarkdownSettings = {
    useMarkdownLinks: true,
    yamlProperties: '',
    tags: '',
    templatePath: ''
};

export default class ImageToMarkdownPlugin extends Plugin {
    settings: ImageToMarkdownSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new ImageToMarkdownSettingTab(this.app, this));

        this.registerEvent(this.app.workspace.on('file-menu', (menu, abstractFile) => {
            if (abstractFile instanceof TFile && ['png', 'jpg', 'jpeg', 'gif'].includes(abstractFile.extension.toLowerCase())) {
                menu.addItem((item) => {
                    item.setTitle('Generate Markdown for Image')
                        .setIcon('document')
                        .onClick(async () => {
                            await this.createMarkdownForImage(abstractFile);
                        });
                });
            } else if (abstractFile instanceof TFolder) {
                menu.addItem((item) => {
                    item.setTitle('Generate Markdown for All Images in Folder')
                        .setIcon('document')
                        .onClick(async () => {
                            await this.createMarkdownForFolder(abstractFile);
                        });
                });
            }
        }));
    }

	
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async createMarkdownForImage(file: TFile) {
        if (!file.parent) {
            new Notice("The file has no parent path");
            return;
        }

        const fileName = file.basename;
        const filePath = file.path;

        // Lesen der Bilddaten
        const arrayBuffer = await this.app.vault.adapter.readBinary(filePath);
        const parser = ExifParserFactory.create(arrayBuffer);
        const exifData = parser.parse();

        // EXIF-Daten in YAML-Format umwandeln
        let yamlFrontmatter = '---\n';
        const tags = exifData.tags ?? {};
        for (const [key, value] of Object.entries(tags)) {
            yamlFrontmatter += `${key}: ${value}\n`;
        }

        // Benutzerdefinierte YAML-Eigenschaften hinzufügen
        const customProperties = this.settings.yamlProperties.split(',').map(prop => prop.trim());
        customProperties.forEach(prop => {
            const [key, value] = prop.split(':').map(part => part.trim());
            yamlFrontmatter += `${key}: ${value}\n`;
        });

        // Tags hinzufügen
        if (this.settings.tags) {
            const tagsList = this.settings.tags.split(',').map(tag => tag.trim()).join(', ');
            yamlFrontmatter += `tags: ${tagsList}\n`;
        }

        // Aktuelles Datum im ISO-Format "YYYY-MM-DD"
        const currentDate = new Date();
        const formattedDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        yamlFrontmatter += `created: ${formattedDate}\n`;
        yamlFrontmatter += '---\n';

        const encodedFilePath = encodeURI(filePath);
        const link = this.settings.useMarkdownLinks ? `[${fileName}](${encodedFilePath})` : `[[${filePath}]]`;
        const markdownContent = `${yamlFrontmatter}\n${link}`;

        const newFilePath = `${file.parent.path}/${fileName}.md`;
        if (!await this.app.vault.adapter.exists(newFilePath)) {
            await this.app.vault.create(newFilePath, markdownContent);
            new Notice(`Markdown file created: ${newFilePath}`);
        } else {
            new Notice(`Markdown file already exists: ${newFilePath}`);
        }
    }

    async createMarkdownForFolder(folder: TFolder) {
        const files = this.app.vault.getFiles();
        const imageFiles = files.filter(file => file.path.startsWith(folder.path) && ['png', 'jpg', 'jpeg', 'gif'].includes(file.extension.toLowerCase()));

        for (const file of imageFiles) {
            await this.createMarkdownForImage(file);
        }
    }

}

class TemplateSuggestModal extends SuggestModal<string> {
    plugin: ImageToMarkdownPlugin;

    constructor(app: App, plugin: ImageToMarkdownPlugin) {
        super(app);
        this.plugin = plugin;
    }

    getSuggestions(query: string): string[] {
        return this.plugin.app.vault.getMarkdownFiles()
            .map(file => file.path)
            .filter(path => path.toLowerCase().includes(query.toLowerCase()));
    }

    renderSuggestion(templatePath: string, el: HTMLElement) {
        el.createEl('div', { text: templatePath });
    }

    onChooseSuggestion(templatePath: string, evt: MouseEvent | KeyboardEvent) {
        this.plugin.settings.templatePath = templatePath;
        this.plugin.saveSettings();
        new Notice(`Template selected: ${templatePath}`);
    }
}

class ImageToMarkdownSettingTab extends PluginSettingTab {
    plugin: ImageToMarkdownPlugin;

    constructor(app: App, plugin: ImageToMarkdownPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Image to Markdown Settings' });

        new Setting(containerEl)
            .setName('Use Markdown Links')
            .setDesc('If enabled, links will be in Markdown format. If disabled, links will be in Wiki format.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useMarkdownLinks)
                .onChange(async (value) => {
                    this.plugin.settings.useMarkdownLinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('YAML Properties')
            .setDesc('Comma-separated list of YAML properties to add to each file. Format: key:value')
            .addTextArea(text => text
                .setPlaceholder('property1: value1, property2: value2')
                .setValue(this.plugin.settings.yamlProperties)
                .onChange(async (value) => {
                    this.plugin.settings.yamlProperties = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Tags')
            .setDesc('Comma-separated list of tags to add to each file. Do not include the # symbol.')
            .addTextArea(text => text
                .setPlaceholder('tag1, tag2, tag3')
                .setValue(this.plugin.settings.tags)
                .onChange(async (value) => {
                    this.plugin.settings.tags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Template Path')
            .setDesc('Path to the template file to apply to new markdown files.')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('path/to/template.md')
                    .setValue(this.plugin.settings.templatePath)
                    .onChange(async (value) => {
                        this.plugin.settings.templatePath = value;
                        await this.plugin.saveSettings();
                    });

                // Hinzufügen einer Schaltfläche zum Durchsuchen der Vorlagen
                const button = document.createElement('button');
                button.setText('Browse');
                button.addEventListener('click', () => {
                    new TemplateSuggestModal(this.app, this.plugin).open();
                });
                textComponent.inputEl.parentElement?.appendChild(button);
            });
    }
}
