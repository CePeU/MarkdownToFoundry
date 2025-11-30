import * as fspath from "path";
import * as fs from "fs";
//import { App,TFile, normalizePath } from "obsidian";
import { MarkdownToFoundrySettings } from "src/settings";
import { debug, ObsidianPicture } from "./utils";

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special regex chars
}

function safeReplace(input: string, search: string, replacement: string): string {

  const escapedSearch = escapeRegExp(search);
  const regex = new RegExp(escapedSearch, 'g');
  const result =input.replace(regex, replacement);

  return result;
}

function buildNormalizedPath(filePath: string,fileName: string):string {   
    const normalizedPath = fspath.normalize(filePath);
    const sanitizedFilename = fileName.replace(/[<>:"/\\|?*]/g, '');
    // Construct full path safely
    const resolvedPath = fspath.resolve(normalizedPath);
    const fullPath = fspath.join(resolvedPath, sanitizedFilename);
    return fullPath
}

// HTML PICTURE PATH export and RELINK og Pictures
export async function writeToFilesystem_Pictures (destinationPath:string,pictureCollection: ObsidianPicture[],html: string,settings:MarkdownToFoundrySettings):Promise<any>{
        debug.log("writeToFilesystem_Pictures - Picture copy:", pictureCollection);
        // Need to refetch the file list in Foundry! Because this could be a new
        // manual import and NOT a batch! So to avoid to overwrite I need an update
        // either at the START or at the END to update the shared information in
        // the static variable!!

        //Set basenames and export base export paths if for any reason none are available
        
        let exportDestinationPath = settings.htmlPictureExportFilePath || destinationPath || ""; 

        //let exportDestinationName = "Unnamed" + Date.now() + ".jpg";
        let replacedHTML = html || ""
        let finalPicturePath = exportDestinationPath //These are the absolute picture paths


        if (settings.htmlPictureRelativeExportFilePath){ // change to relative picture file paths if they are set
            finalPicturePath = settings.htmlPictureRelativeExportFilePath
        }
/*
You need to parse the embeds again ... maybe do this allready during first cleanup cycle and create a second html
or create a collection of embedded links also and not only of picture paths
Insert replacement of <a href=xxxx > with xxxx = modified reference path
const hrefToAdjust = `<a href="${DSA Kampagne/Kor Vertrag.md}">`
replacedHTML = safeReplace(replacedHTML, "<a href=currentPicturePathInHtml, fullPath);
*/

        if (pictureCollection.length === 0) return replacedHTML;

        while (pictureCollection.length > 0) {
            // holds all pictures from batch (but not from batch to next batch!!)

            const firstElement = pictureCollection[0]; //replace following instances with firstElement for readability
            const pictureSourceFilePath = pictureCollection[0]?.ObsidianPictureId; //source filepath
            const pictureFileName = firstElement.ObsidianPictureHashName ?? firstElement.ObsidianPictureName

            //const abstractFile = Foundry.app.vault.getFileByPath(Foundry.ObsidianPictureCollection[0].ObsidianPicturePath);

            const currentPicturePathInHtml=firstElement.ObsidianPictureURI
            //const replacementPicturePath = 
            /*
            const pictureFile = pictureCollection[0].ObsidianPictureFileObj;
            let binary: ArrayBuffer = new ArrayBuffer(0);
            if (pictureFile instanceof TFile) {
                const file: TFile = pictureFile;  //this line can be removed
                binary = await app.vault.readBinary(file); // read binary file and load it for copy
            } //END of if to make sure a file is read
            */
            //{{baseUrl}}/upload?clientId={{clientId}}&path=/obsidian-files/pictures&filename=test.png&mimeType=image/png

            
            //exportDestinationName = pictureCollection[0].ObsidianPictureHashName || exportDestinationName;
            //console.log("Export Destination Name: ", exportDestinationName)

            await writeToFilesystem(exportDestinationPath,pictureFileName,"",pictureSourceFilePath)
                //showBrowserNotification("File copy successfull");
            
            let fullPicturePath=buildNormalizedPath(finalPicturePath,pictureFileName)

            if (settings.htmlPictureRelativeExportFilePath){ 
            // normalized filepaths to not work for relative paths in a FILESYSTEM and will not be resolved correctly in the function buildNormalizedPath
            //console.log("=== relative picture Export file path ",settings.htmlPictureRelativeExportFilePath)
            //console.log("=== test finalPicturePath: + /+Picture: ",finalPicturePath)
             if(settings.htmlPictureRelativeExportFilePath === "./") {
                fullPicturePath=finalPicturePath+pictureFileName.replace(/[<>:"/\\|?*]/g, '');
             } else {
                fullPicturePath=finalPicturePath+"/"+pictureFileName.replace(/[<>:"/\\|?*]/g, '');
            }
            }
            //const normalizedPath = fspath.normalize(exportDestinationPath);
            //console.log("==Normalized path:",normalizedPath)
            //const sanitizedFilename = exportDestinationName.replace(/[<>:"/\\|?*]/g, '');
            //console.log("==Sanitizes FileName:",sanitizedFilename)
            // Construct full path safely
            //const resolvedPath = fspath.resolve(normalizedPath);
            //console.log("==Resolvedf Path:",resolvedPath)
            //const fullPath = fspath.join(resolvedPath, sanitizedFilename);
            //console.log("==FullPath:",fullPath)

            replacedHTML = safeReplace(replacedHTML, currentPicturePathInHtml, fullPicturePath);

            //IMPORTANT: Need to create HTML picture obects beforehand

            //remove allready uploaded consumed pictures
            const nameToRemove = firstElement.FoundryPictureHashPath;
            //Remove all objects with the same html destination!! hashpath

            pictureCollection = pictureCollection.filter(
                obj => obj?.FoundryPictureHashPath !== nameToRemove
            );//first element and all other of the same type are eliminated so next element is first again
            }
            
            return replacedHTML;
        }

//===============================Write html file============================================================
//extend Error interface with two new properties
interface FileOperationError extends Error {
    returnCode?: string;
    errorDetails?: Record<string, unknown>;
}

interface FileOperationResult<T> {
    success: boolean;
    data?: T;
    error?: FileOperationError;
}



async function copyFileAsync(sourcePath:string,destinationPath: string):Promise<FileOperationResult<void>> {
  try {
    await fs.promises.copyFile(sourcePath, destinationPath);
    debug.log('File copied successfully!');
    return { success: true };
  } catch (error) {
    debug.log('Error copying file:', error);
           return {
            success: false,
            error: {
                ...error,
                returnCode: 'COPY_FAILED',
                errorDetails: { destinationPath}
            }
        };
  }
}



export async function writeToFilesystem(
    destinationPath: string,
    filename: string,
    fileContent?: string | Buffer,
    sourcePathAndName?: string,
): Promise<FileOperationResult<void>> {
    const startTime = process.hrtime.bigint();
    const content = fileContent ?? ""; 
    const source = sourcePathAndName ?? "";

    // Input validation and sanitization
    if (!destinationPath || !filename) {
        return {
            success: false,
            error: {
                ...new Error("Invalid parameters"),
                returnCode: "INVALID_INPUT",
                errorDetails: { destinationPath, filename }
            }
        };
    }

    try {
        // Normalize path and sanitize filename
        //const normalizedPath = fspath.normalize(destinationPath);
        //console.log("==Normalized path:",normalizedPath)
        //const sanitizedFilename = filename.replace(/[<>:"/\\|?*]/g, '');
        //console.log("==Sanitizes FileName:",sanitizedFilename)
        // Construct full path safely
        //const resolvedPath = fspath.resolve(normalizedPath);
        //console.log("==Resolvedf Path:",resolvedPath)
        //const fullPath = fspath.join(resolvedPath, sanitizedFilename);
        //console.log("==FullPath:",fullPath)
        // Verify directory permission - which makes no sense because I cannot discerne if it is a read or a not exist error
       // await verifyDirectoryPermissions(fspath.dirname(fullPath));

        const fullPath=buildNormalizedPath(destinationPath,filename)

        // Create directory if permissions exist
        const dirCreationResult = await createDirectorySafely(
            fspath.dirname(fullPath),
            { recursive: true }
        );
        // if directory could not be created return an error
        if (!dirCreationResult.success) {
            return {
                success: false,
                error: dirCreationResult.error
            };
        }
 if (source && dirCreationResult.success){
const copyFileResult = await copyFileAsync(source,fullPath)

        if (!copyFileResult.success) {
            return {
                success: false,
                error: copyFileResult.error
            };
        }

 } else {
    if (filename && dirCreationResult.success){
        const writeFileResult = await performAtomicWrite(
            fullPath,
            content ?? Buffer.alloc(0)
        );

        if (!writeFileResult.success) {
            return {
                success: false,
                error: writeFileResult.error
            };
        }
    }
    }

        // Log performance metrics
            const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
            debug.log(`Operation completed in ${duration.toFixed(2)}ms`);
            debug.log("This content was to be saved as output: ",content)

        return { success: true };

    } catch (error) {
        const typedError = error instanceof Error ? error : new Error(String(error));
        return {
            success: false,
            error: {
                ...typedError,
                returnCode: 'UNKNOWN_ERROR',
                errorDetails: { operation: 'writeFile' }
            }
        };
    }
}

/* This test probably makes no sense as I cannot determine if I have no access or the directory does not exist
// Helper functions for determining directory permission
async function verifyDirectoryPermissions(dirPath: string): Promise<void> {
    try {
        console.log("I was checking for access")
        await fs.promises.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
        console.log("I checked")
    } catch (error) {
        console.log("Permission denied")
        throw new Error(`Permission denied for directory ${dirPath}`);
    }
}
*/

async function createDirectorySafely(
    path: string,
    options: { recursive: boolean }
): Promise<FileOperationResult<void>> {
    try {
        debug.log("Creating directory")
        await fs.promises.mkdir(path, options);
        return { success: true };
    } catch (error) {
        if (error.code === 'EEXIST') {
            return { success: true }; // Directory already exists
        }
        
        return {
            success: false,
            error: {
                ...error,
                returnCode: 'DIRECTORY_CREATION_FAILED',
                errorDetails: { path }
            }
        };
    }
}

async function performAtomicWrite(
    path: string,
    content: Buffer | string
): Promise<FileOperationResult<void>> {
    try {
        const tempPath = `${path}.tmp`;
        console.log("=== tempPath: ",tempPath)
        console.log("=== tempPath: ",path)
        
        await fs.promises.writeFile(tempPath, content, 'utf8');
        
        // Atomic rename operation - /outputpath/file.html.tmp ==> /outputpath/file.html
        await fs.promises.rename(tempPath, path);
        debug.log(`Successfully renamed file: ${path}`); 
        return { success: true };
    } catch (error) {
        // Clean up temporary file if it exists
        try {
            await fs.promises.unlink(`${path}.tmp`);
        } catch (cleanupError) {
            // Log cleanup failure but continue
            debug.log('Failed to clean up temporary file:', cleanupError);
        }
        
        return {
            success: false,
            error: {
                ...error,
                code: 'FILE_WRITE_FAILED',
                details: { path }
            }
        };
    }
}
