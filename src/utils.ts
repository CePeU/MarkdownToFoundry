import { join } from "path";
import * as fs from "fs";
import { TFile } from "obsidian";

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

export function writeFileOnWindows(path: string, filename: string, content: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const fullPath = join(path, filename);

		fs.mkdir(path, { recursive: true }, err => {
			if (err) {
				reject("Error creating directory: " + path + " Error : " + err);
			} else {
				resolve();
				console.debug("M2F: Directory created successfully:", path);
				//const createDir = fs.promises;
				//createDir.mkdir(path, { recursive: true });
			}
		});
		fs.writeFile(fullPath, content, err => {
			if (err) {
				reject("Error writing file: " + fullPath + " Error : " + err);
			} else {
				resolve();
				console.debug("M2F: File written successfully:", path);
			}
			//resolve();
		});
	});
}
