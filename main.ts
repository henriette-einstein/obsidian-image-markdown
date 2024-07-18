import { Plugin, TFile, TFolder, Notice, PluginSettingTab, Setting, App, SuggestModal, Vault } from 'obsidian';
import { ExifParserFactory } from 'ts-exif-parser';
import * as yaml from 'js-yaml';


interface ImageToMarkdownSettings {
    useMarkdownLinks: boolean;
    yamlProperties: string;
    targetPath: string;
}

const DEFAULT_SETTINGS: ImageToMarkdownSettings = {
    useMarkdownLinks: true,
    yamlProperties: '',
    targetPath: ''
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

		new Notice("Reading image");
        // Lesen der Bilddaten
        const arrayBuffer = await this.app.vault.adapter.readBinary(filePath);
        const parser = ExifParserFactory.create(arrayBuffer);
        const exifData = parser.parse();

		new Notice("generating yaml for");

        // EXIF-Daten in YAML-Format umwandeln
        let yamlFrontmatter = '---\n';

		if (exifData.getImageSize()) {
			const height = exifData.getImageSize().height
			yamlFrontmatter += `exif-height: ${height}\n`;
			const width = exifData.getImageSize().width
			yamlFrontmatter += `exif-width: ${width}\n`;
		} else {
			new Notice("No EXIF data")
		}
		const tags = exifData.tags ?? {};
		for (const [key, value] of Object.entries(tags)) {
			yamlFrontmatter += `exif-${key}: ${value}\n`;
		}

        // Benutzerdefinierte YAML-Eigenschaften hinzufügen
        const customProperties = this.settings.yamlProperties.split(/\r?\n/).map(prop => prop.trim());
        customProperties.forEach(prop => {
            const [key, value] = prop.split(':').map(part => part.trim());
            yamlFrontmatter += `${key}: ${value}\n`;
        });
		new Notice(yamlFrontmatter)

        // Aktuelles Datum im ISO-Format "YYYY-MM-DD"
        const currentDate = new Date();
        const formattedDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        yamlFrontmatter += `created: ${formattedDate}\n`;
        yamlFrontmatter += '---\n';

		new Notice(yamlFrontmatter)
        const encodedFilePath = encodeURI(filePath);
        const link = this.settings.useMarkdownLinks ? `![${fileName}](${encodedFilePath})` : `![[${filePath}]]`;
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

class TargetDirSuggestModal extends SuggestModal<string> {
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
        this.plugin.settings.targetPath = templatePath;
        this.plugin.saveSettings();
        new Notice(`Template selected: ${templatePath}`);
    }
}

class FolderSuggestModal extends SuggestModal<TFolder> {
    plugin: ImageToMarkdownPlugin;

    constructor(app: App, plugin: ImageToMarkdownPlugin) {
        super(app);
        this.plugin = plugin;
    }

    // Return all available folders in the vault
    getSuggestions(query: string): TFolder[] {
        const folders: TFolder[] = [];
        Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
            if (file instanceof TFolder) {
                folders.push(file);
            }
        });
        return folders.filter((folder) => folder.path.toLowerCase().includes(query.toLowerCase()));
    }

    // Render each folder suggestion
    renderSuggestion(folder: TFolder, el: HTMLElement) {
        el.createEl('div', { text: folder.path });
    }

    // Handle the folder selection
    onChooseSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent) {
        this.plugin.settings.targetPath = folder.path;
        this.plugin.saveSettings();
        new Notice(`Selected folder: ${folder.path}`);
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
            .setDesc('List of YAML properties to add to each file. Format: key:value. Add one property per line')
            .addTextArea(text => text
                .setPlaceholder('property1: value1\n property2: value2')
                .setValue(this.plugin.settings.yamlProperties)
                .onChange(async (value) => {
                    this.plugin.settings.yamlProperties = value;
                    await this.plugin.saveSettings();
                }));

		/*
		new Setting(containerEl)
            .setName('Target Path')
            .setDesc('Path to the folder to store to new markdown files.')
            .addText(text => {
                const textComponent = text
                    .setPlaceholder('target folder')
                    .setValue(this.plugin.settings.targetPath)
                    .onChange(async (value) => {
                        this.plugin.settings.targetPath = value;
                        await this.plugin.saveSettings();
                    });

                // Hinzufügen einer Schaltfläche zum Durchsuchen der Vorlagen
                const button = document.createElement('button');
                button.setText('Browse');
                button.addEventListener('click', () => {
                    new FolderSuggestModal(this.app, this.plugin).open();
                });
                textComponent.inputEl.parentElement?.appendChild(button);
            });
		*/

    }
}
