/**
 * CUTT.LY Panel Selectors
 * For team shortlink management at cutt.ly
 */
export const CUTTLY_SELECTORS = {
  // Login page
  login: {
    emailInput: '#email',
    passwordInput: '#password',
    submitButton: 'button.g-recaptcha',
    form: '#login',
  },

  // Search results
  urlOptions: '.url_options',
  urlLink: '.url_options .url_link a',
  shortUrlLink: '.url_options .short_url_l',
  changeUrlButton: '.url_options a[href*="/change/"]',

  // Pagination
  paginationLinks: '.result a[href*="/search/"]',

  // Change URL page
  linkInput: 'input[name="link"]',
  changeSubmit: 'input[type="submit"][value="Change"]',
};
