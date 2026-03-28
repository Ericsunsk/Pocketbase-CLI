import packageJson from "../../package.json";

export const CLI_VERSION = packageJson.version;
export const CLI_USER_AGENT = `pocketbase-cli/${CLI_VERSION}`;
