//import * as fspath from "path";
//import * as fs from "fs";
import { MarkdownToFoundrySettings } from "src/settings";
import {
	App,
	TFile,
	normalizePath,
	FileSystemAdapter,
	Notice,
} from "obsidian";
//import xxhash, { XXHashAPI } from "xxhash-wasm"; //fast hashing algo for pictures - not sure if note hashing also makes sense
import xxhash from "xxhash-wasm"; //fast hashing algo for pictures - not sure if note hashing also makes sense

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



export function createRelativePath(fileObj:TFile): string{
	let relativePath= fileObj.path.slice(0, -fileObj.name.length);
	return relativePath ?? ""
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

/*
export async function writeFileOnWindows(path: string, filename: string, content: string, settings: MarkdownToFoundrySettings): Promise<void> {
	return new Promise((resolve, reject) => {
		const filePath = fspath.resolve(path)//normalizePath(path);
		const fullPath = fspath.join(filePath, filename);
		
		// Check if directory exists
        const dirExists = fs.promises.access(fspath.dirname(filePath));
		
		console.log("filePath:",filePath)
		console.log("fullPath:",fullPath)
		console.log("Path:",path)
	if (content !== undefined) {
		if (!dirExists){
		fs.mkdir(filePath, { recursive: true }, err => {
			if (err) {
				reject("Error creating directory: " + filePath + " Error : " + err);
			} else {
				fspath.resolve();
				if(settings.isDebugOutput) {
					debug.log("Directory created successfully:", filePath);
				}
				//const createDir = fs.promises;
				//createDir.mkdir(path, { recursive: true });
			}
		});}
		
		fs.writeFile(fullPath, content, err => {
			if (err) {
				reject("Error writing file: " + fullPath + " Error : " + err);
			} else {
				fspath.resolve();
				if (settings.isDebugOutput) {
					debug.log("File written successfully:", fullPath);
				}
			}
			//resolve();
		});
	}
	});
}*/

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

export async function buildPictureUploadList(nodeHtml:HTMLElement,app: App, noteFile: TFile, pictureSavePath: string): Promise<ObsidianPicture[]> {
	debug.log("buildPictureUploadList function started");
	//let xxhashAPI = await xxhash(); // init the hasher object (do I need this? - probably not)
	const pictureList: ObsidianPicture[] = [];
	const imageExtensions = ["jpg", "jpeg", "gif", "bmp", "png", "svg", "webp"]; //".png",
	const bigIntNumber = BigInt(987654321);
	if (!noteFile || !nodeHtml) return pictureList ?? [];
	//Collect alls Links which are found in the html node list
	//Collect all <img> tags which do NOT start with http or https
	// then get the src attribute and use it to find the TFile object in the vault
	// then read the binary data from the TFile object
	// then create a hash from the binary data
	// then build the ObsidianPicture object and add it to the list
	
	//const imageLinkList = nodeHtml.querySelectorAll('img:not([src^="http"], [src^="https"], [src^="data:"], [src^="blob:"])') as NodeListOf<HTMLImageElement>; //List of relevant tags
	
	const imageLinkList = nodeHtml.querySelectorAll('img[src^="app://"], img:not([src*=":"])') as NodeListOf<HTMLImageElement> //or selecctor if app:// or no : at all
	debug.log("Found the following imageLinkList:", imageLinkList);
	if (imageLinkList.length === 0) return pictureList ?? []; //return if no images found

	const adapter = app.vault.adapter;
	let obsidianNoteBasePath = "";
	let obsidianNoteFilePath = "";
	let obsidianNoteAbsolutePath = "";
	let obsidianPictureAbsolutePath = "";
		
	//TODO:We know we have a FileSystemAdapter - but only on Desktop - on mobile it is different!
	//So we need to check if the adapter is of type FileSystemAdapter
	//If it is not we cannot get the base path and file path - so we cannot proceed
	//If we have a mobile adapter we need to use vault.getResourcePath(myFile) to get the absolute path

	//We also know we have a note so we also know we have a file path
	//We need the base path to get the relativepath from the src attribute
	//Also the image src is relative to the vault base path
	
	//Let us fill the note file information as we allready have them
	if (adapter instanceof FileSystemAdapter) {
		obsidianNoteBasePath = adapter?.getBasePath() ?? "";
		obsidianNoteFilePath = adapter?.getFilePath(noteFile.path) ?? "";
		obsidianNoteAbsolutePath = adapter?.getFullPath(noteFile.path) ?? "";
		}

	// absolutePath is the full system path, e.g., "C:/Users/YourName/ObsidianVault/folder/note.md"
	// for mobile devices use const absolutePath = vault.getResourcePath(myFile); in that case adaper is not of type FileSystemAdapter
	
	//Let us build the information from the list of links we have collected
	for (let i = 0; i < imageLinkList.length; i++) {
		const imageNode = imageLinkList[i];
		const imgSrc = imageNode?.src ?? "";
		//const imgAlt = imageNode?.alt ?? ""; //probably not needed anymore but can give the title of the picture
		if (!imgSrc) continue;	//skip if no src exists
		if (imgSrc.startsWith("http") || imgSrc.startsWith("https")) continue; //skip if src is a URL - but this should be already filtered by the selector

//FIXME: The Regex needs to be smarter to fetch everything between base path and last questionmark. Linux allows for questionmarks in filenames and maybe also in paths
// Remove the app protocol and query parameters
const cleanPath = imgSrc.split('?')[0].replace(/^app:\/\/[0-9a-f]+/, '');
debug.log('Cleaned picture path:', cleanPath);

//TODO: Check if only URI paths can and should be used (for mobile and in general for special characters?)
//The html has an uri path so we need to return in to a non uri
const cleanedUriPath = decodeURIComponent(cleanPath);
debug.log('Decoded URI path:', cleanedUriPath);

// Normalize the path - makes sure to remove redundant slashes and backslashes
const normalizedPicturedPath = normalizePath(cleanedUriPath);
debug.log('Normalized picture path:', normalizedPicturedPath);


// Normalize the obsidianNoteBasePath - makes sure to remove redundant slashes and backslashes
const normalizedBasePath = normalizePath(obsidianNoteBasePath);
debug.log('Normalized base path:', normalizedBasePath);

//Split off the base path part of the full picture link and if base parts are "identical"
// derive the relative path
const splitOffBasePathForCheck=normalizedPicturedPath.slice(0,normalizedBasePath.length)
debug.log("SplitOffPart",splitOffBasePathForCheck)
let constructRelativePath=""
if (splitOffBasePathForCheck.toLocaleLowerCase()===normalizedBasePath.toLocaleLowerCase()){
constructRelativePath = normalizedPicturedPath.slice(normalizedBasePath.length,normalizedPicturedPath.length)
} else {
	new Notice(`Base path mismatch! Relative vault path to picure ${imgSrc} could not be retrieved. Vault base path is ${normalizedBasePath}`, 5000); // 5000 ms = 5 seconds duration
	debug.log(`Base path mismatch! Relative vault path to picure ${imgSrc} could not be retrieved. Vault base path is ${normalizedBasePath}`);
}
// Extract relative path with a regex
//const relativePath = cleanedUriPath.replace(normalizedBasePath, '').replace(/^[\\/]/, '');
debug.log('Relative picture path:', constructRelativePath);

// Get TFile object
const noteFilePath = noteFile?.path ?? "";
//const pictureFile = this.app.metadataCache.getFirstLinkpathDest(
//	relativePath,noteFilePath,
//	);
const pictureFile = this.app.metadataCache.getFirstLinkpathDest(
	constructRelativePath,noteFilePath,
	);
if (!pictureFile) {
	debug.log('No TFile found for path:', constructRelativePath);
	continue; //skip if no pictureFile found
}
debug.log('Extracted pictureFile path:', constructRelativePath);
debug.log('Picture TFile object:', pictureFile);
debug.log('Picture file extension:', pictureFile?.extension);

// Check if the pictureFile has a valid image extension
const fileExtension = imageExtensions.find(ext => pictureFile?.extension.toLowerCase().endsWith(ext));

if (!fileExtension) {
	debug.log('Skipping pictureFile due to invalid extension');
	continue; //skip if no valid pictureFile extension is found
}
if (adapter instanceof FileSystemAdapter) {
		obsidianPictureAbsolutePath = adapter?.getFullPath(pictureFile.path) ?? "";
	}
				const binaryFile = await app.vault.readBinary(pictureFile); // read binary data
				const binaryUint8Array = new Uint8Array(binaryFile);

				const { h32, h32ToString, h32Raw, create32, h64, h64ToString, h64Raw, create64 } = await xxhash();

				const pictureHash = h64Raw(binaryUint8Array, bigIntNumber).toString(16).padStart(16, "0");

			const obsidianPicture: ObsidianPicture = {
					ObsidianId: obsidianNoteAbsolutePath,
					ObsidianFilePath: noteFile?.path ?? "",
					ObsidianFileName: noteFile?.name ?? "",
					//ObsidianFileObj:noteFile, //for now only for debug purposes

					ObsidianPictureId: obsidianPictureAbsolutePath,
					ObsidianPicturePath: pictureFile?.path ?? "",
					ObsidianPictureName: pictureFile?.name ?? "",
					ObsidianPictureFileObj: pictureFile, // for now only for debug purposes

					ObsidianPictureExtension: pictureFile?.extension ?? "",
					ObsidianPictureHash: pictureHash,
					ObsidianPictureHashName: pictureFile?.basename + "_" + pictureHash + "." + pictureFile?.extension,
					ObsidianPictureModificationTime: pictureFile?.stat?.mtime ?? 0,
					ObsidianPictureURI: pictureFile.vault.getResourcePath(pictureFile) ?? "",
					FoundryPictureHashPath: pictureSavePath + "/" + pictureFile?.basename + "_" + pictureHash + "." + pictureFile?.extension,
					FoundryPictureUploadPath: pictureSavePath,
				};
				pictureList.push(obsidianPicture);				
}
	return pictureList ?? [];
}
