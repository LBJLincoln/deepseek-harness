import { replaceAll } from "../../native/replace-all.js";
export function removeApostrophe(str) {
    return replaceAll(str, "'", '');
}
