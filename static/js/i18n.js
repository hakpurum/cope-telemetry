"use strict";

window.locale = document.documentElement.lang === "en" ? "en-US" : "tr-TR";
const translations = JSON.parse(document.getElementById("translations").textContent);
window.tr = (text, values = {}) => {
  const template = document.documentElement.lang === "en" ? (translations[text] ?? text) : text;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
};
