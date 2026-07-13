/**
 * Supported Languages Configuration
 *
 * Only English and Spanish are shipped with the app.
 */

export const languages = [
  {
    value: 'es',
    label: 'Spanish',
    nativeName: 'Español',
  },
  {
    value: 'en',
    label: 'English',
    nativeName: 'English',
  },
];

/**
 * Get language object by value
 * @param {string} value - Language code
 * @returns {Object|undefined} Language object or undefined if not supported
 */
export const getLanguage = (value) => {
  return languages.find(lang => lang.value === value);
};

/**
 * Get all language values
 * @returns {string[]} Array of language codes
 */
export const getLanguageValues = () => {
  return languages.map(lang => lang.value);
};

/**
 * Check if a language is supported
 * @param {string} value - Language code to check
 * @returns {boolean} True if language is supported
 */
export const isLanguageSupported = (value) => {
  return languages.some(lang => lang.value === value);
};
