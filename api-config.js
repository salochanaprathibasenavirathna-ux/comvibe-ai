const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSION_PATH = "/v1beta";

export const GEMINI_INTERACTIONS_URL = `${GEMINI_API_BASE_URL}${GEMINI_API_VERSION_PATH}/interactions`;
export const GEMINI_FILES_UPLOAD_URL = `${GEMINI_API_BASE_URL}/upload${GEMINI_API_VERSION_PATH}/files`;
export const GEMINI_MODELS_URL = `${GEMINI_API_BASE_URL}${GEMINI_API_VERSION_PATH}/models`;

export function getGeminiFileUrl(fileName) {
  return `${GEMINI_API_BASE_URL}${GEMINI_API_VERSION_PATH}/${fileName}`;
}
