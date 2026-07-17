import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const languageStuff = panoContext.context.utils.language;

const languageLoading = languageStuff.languageLoading;
const currentLanguage = languageStuff.currentLanguage;
const Languages = languageStuff.Languages;
const init = languageStuff.init;
const getAcceptedLanguage = languageStuff.getAcceptedLanguage;
const loadLanguage = languageStuff.loadLanguage;
const changeLanguage = languageStuff.changeLanguage;
const getLanguageByLocale = languageStuff.getLanguageByLocale;
const _ = languageStuff._;

export {
  languageLoading,
  currentLanguage,
  Languages,
  init,
  getAcceptedLanguage,
  loadLanguage,
  changeLanguage,
  getLanguageByLocale,
  _,
};
