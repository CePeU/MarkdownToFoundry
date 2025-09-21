import { join } from "path";
import * as fs from "fs";
import { TFile } from "obsidian";
import { MarkdownToFoundrySettings } from "src/settings";

export interface ObsidianPicture {
	ObsidianId: string;
	ObsidianFileName: string;
	ObsidianFilePath: string;
	//ObsidianFileObj?: TFile;

	ObsidianPictureId: string;
	ObsidianPictureName: string;
	ObsidianPicturePath: string;
	ObsidianPictureFileObj?: TFile;

	ObsidianPictureHash?: string;
	ObsidianPictureHashName?: string;
	ObsidianPictureExtension: string;
	ObsidianPictureModificationTime: number;
	ObsidianPictureURI: string;

	FoundryPictureHashPath?: string;
	FoundryPictureUploadPath: string;
}

export function debugLog(message: string, settings?: MarkdownToFoundrySettings, data?: any) {
	if (settings?.isDebugOutput) {
		if (data) {
			console.debug(`M2F: ${message}`, data);
		} else {
			console.debug(`M2F: ${message}`);
		}
	}
}

export function showBrowserNotification(title: string, options?: NotificationOptions) {
	if (Notification.permission === "granted") {
		new Notification(title, options);
	} else if (Notification.permission !== "denied") {
		Notification.requestPermission().then(permission => {
			if (permission === "granted") {
				new Notification(title, options);
			}
		});
	}
}

export function removeEmptyLines(text: string): string {
	return text.replace(/^\s*/gm, "");
}

export function isEmpty(text: string): boolean {
	return removeEmptyLines(text).length === 0;
}

export function writeFileOnWindows(path: string, filename: string, content: string, settings: MarkdownToFoundrySettings): Promise<void> {
	return new Promise((resolve, reject) => {
		const fullPath = join(path, filename);

		fs.mkdir(path, { recursive: true }, err => {
			if (err) {
				reject("Error creating directory: " + path + " Error : " + err);
			} else {
				resolve();
				if(settings.isDebugOutput) {
					console.debug("M2F: Directory created successfully:", path);
				}
				//const createDir = fs.promises;
				//createDir.mkdir(path, { recursive: true });
			}
		});
		fs.writeFile(fullPath, content, err => {
			if (err) {
				reject("Error writing file: " + fullPath + " Error : " + err);
			} else {
				resolve();
				if (settings.isDebugOutput) {
					console.debug("M2F: File written successfully:", path);
				}
			}
			//resolve();
		});
	});
}

export class DebugLogger {
	private static instance: DebugLogger;
	private isDebugEnabled: boolean = false;

	private constructor() {}

	//Call the instanciation method to fill the instance property with a DebugLogger object
	//the DebugLogger object is created only once and holds the state of the debug mode
	// and also offers the log method to log messages if debug mode is enabled
	public static getInstance(): DebugLogger {
		if (!DebugLogger.instance) {
			DebugLogger.instance = new DebugLogger();
		}
		return DebugLogger.instance;
	}

	public setDebugMode(onOff: boolean): void {
		this.isDebugEnabled = onOff;
	}

	public log(message: string, data?: any): void {
		if (this.isDebugEnabled) {
			if (data) {
				console.debug(`M2F: ${message}`, data);
			} else {
				console.debug(`M2F: ${message}`);
			}
		}
	}
}

export const debug = DebugLogger.getInstance();