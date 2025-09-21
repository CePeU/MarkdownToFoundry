import { readFileSync, write, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

writeFileSync("src/versionConstant.ts", `export const VERSION_CONSTANTS = {
    MAJOR: ${targetVersion?.split(".")[0]},
    MINOR: ${targetVersion?.split(".")[1]},
    PATCH: ${targetVersion?.split(".")[2]}
};
export const VERSION_STRING = \`\${VERSION_CONSTANTS.MAJOR}.\${VERSION_CONSTANTS.MINOR}.\${VERSION_CONSTANTS.PATCH}\`;    
`);
console.log(`Bumped version to ${targetVersion} with minAppVersion ${minAppVersion}`);
