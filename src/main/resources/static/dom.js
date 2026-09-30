/** Shared DOM lookup helpers for the browser modules. */
export const byId = id => document.getElementById(id);
export const query = (selector, root = document) => root.querySelector(selector);
export const queryAll = (selector, root = document) => [...root.querySelectorAll(selector)];
