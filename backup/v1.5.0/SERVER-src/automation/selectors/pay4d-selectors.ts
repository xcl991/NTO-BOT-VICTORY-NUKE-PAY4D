/**
 * PAY4D Panel Selectors
 * Login page: username + password + image CAPTCHA
 * PIN page: 6-digit PIN via virtual keypad with randomized button positions
 */
export const PAY4D_SELECTORS = {
  // ===== LOGIN PAGE =====
  login: {
    username: '#inputUsername',
    usernameFallbacks: [
      'input#inputUsername',
      'input[name="username"]',
      'input[placeholder*="username" i]',
    ],

    password: '#inputPassword',
    passwordFallbacks: [
      'input#inputPassword',
      'input[name="password"]',
      'input[type="password"]',
    ],

    captchaImage: 'img#captcha',
    captchaImageFallbacks: [
      '#captcha',
      'img[id="captcha"]',
      'img[src*="captcha"]',
    ],

    captchaInput: '#inputCaptcha',
    captchaInputFallbacks: [
      'input#inputCaptcha',
      'input[name="captcha"]',
      'input[placeholder*="captcha" i]',
    ],

    submitButton: 'button[type="submit"]',
    submitButtonFallbacks: [
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'input[type="submit"]',
    ],

    // Error indicators on login page
    errorMessage: '.alert-danger, .alert-error, .error-message, .invalid-feedback',
  },

  // ===== PIN PAGE (inside cross-origin iframe from auth.dotflyby.com) =====
  pin: {
    iframe: 'iframe#pin, iframe.pin',
    card: '#card',
    messageBox: '#msgbox',
    pinDots: '.pin',
    keypadButton: '#keypad button.num',
    keypadButtonFallbacks: [
      '#keypad button',
      '.keypad button.num',
      'button.num',
    ],
    suspendMessage: '#suspend',
  },

  // ===== DASHBOARD / ADMIN AREA =====
  dashboard: {
    // Admin area URL path
    adminAreaPath: '/mimin/adminarea',

    // Sidebar menu panel
    menuPanel: '.panel-group',

    // "Win Lose All" button in sidebar
    winLoseAllButton: 'button.btn-menu:has-text("Win Lose All")',
    winLoseAllButtonFallbacks: [
      'button[onclick*="menuWinLoseAll"]',
      'button:has-text("Win Lose All")',
    ],

    // "Win Lose Togel" button in sidebar
    winLoseTogelButton: 'button.btn-menu:has-text("Win Lose Togel")',
  },

  // ===== WIN LOSE ALL PAGE =====
  winLoseAll: {
    // Page heading
    heading: 'h3:has-text("Win Lose All")',

    // Multiselect dropdown
    multiselectButton: '.multiselect.dropdown-toggle',
    multiselectContainer: '.multiselect-container.dropdown-menu',

    // "Select all" option inside dropdown
    selectAllButton: 'button.multiselect-all',
    selectAllCheckbox: 'button.multiselect-all input.form-check-input',

    // Group buttons (Togel, Slots, Live Casino, Sport, Sabung, Interactive)
    groupButton: (label: string) => `button.multiselect-group[title="${label}"]`,
    groupCheckbox: (label: string) => `button.multiselect-group[title="${label}"] input.form-check-input`,

    // The underlying <select> element
    selectElement: '#winlose-select',

    // Date inputs
    startDate: 'input.datepicker.startDate',
    startDateFallbacks: [
      'input.startDate',
      '.startDate',
    ],
    endDate: 'input.datepicker.endDate',
    endDateFallbacks: [
      'input.endDate',
      '.endDate',
    ],

    // Search button (date-based)
    searchButton: '#adateSearchButton',
    searchButtonFallbacks: [
      'input#adateSearchButton',
      'input[value="Search"]',
    ],

    // Referal input and search
    referalInput: '#awinloseReferal',
    referalSearchButton: '#areferalSearchButton',

    // Results container
    resultsContainer: '#winLoseAllContent',

    // Summary table (appears after search inside #winLoseAllContent)
    summaryTable: '#result',
    summaryTableFallbacks: [
      '#winLoseAllContent table.table',
      '#winLoseAllContent table',
    ],
    summaryAlert: '.alert-success',

    // CSV download button inside the summary table
    downloadCsvButton: 'button[onclick*="detailSummary(\'csv\')"]',
    downloadCsvButtonFallbacks: [
      '#winLoseAllContent button[title="Download CSV"]',
      '#result button .glyphicon-download',
    ],
  },
} as const;
