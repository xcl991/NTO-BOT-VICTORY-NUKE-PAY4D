/**
 * NUKE Panel Selectors
 * Based on Ant Design (antd) components at cpt77.nukepanel.com
 */
export const NUKE_SELECTORS = {
  // ===== LOGIN PAGE =====
  login: {
    // Username input - Ant Design Input with #username id
    username: '#username',
    usernameFallbacks: [
      'input#username',
      'input[placeholder="Username"]',
      '.ant-input-affix-wrapper input.ant-input',
    ],

    // Password input - Ant Design Password Input with #password id
    password: '#password',
    passwordFallbacks: [
      'input#password',
      'input[placeholder="Password"]',
      '.ant-input-password input.ant-input',
    ],

    // Login submit button - Ant Design primary button
    submitButton: 'button[type="submit"].ant-btn-primary',
    submitButtonFallbacks: [
      'button.ant-btn-primary.ant-btn-lg',
      'button[type="submit"]',
      'button:has-text("Login")',
    ],

    // Error message after failed login
    errorMessage: '.ant-message-error, .ant-alert-error, .ant-form-explain',
  },

  // ===== OTP AGREEMENT POPUP (first login) =====
  otpAgreement: {
    // The modal container
    modal: '.ant-modal-content',

    // Title to verify it's the OTP agreement
    title: '.antd-pro-app-cache-src-components-modal-otp-agreement-index-otpAgreementTitle',

    // Checkbox "Saya telah mengerti dan menyetujui..."
    checkbox: '.ant-checkbox-input',
    checkboxFallbacks: [
      '.ant-modal-content .ant-checkbox-input',
      '.ant-checkbox-wrapper .ant-checkbox-input',
      'input[type="checkbox"].ant-checkbox-input',
    ],

    // "Lanjutkan" button
    continueButton: '.antd-pro-app-cache-src-components-modal-otp-agreement-index-otpAgreementButton .ant-btn-primary',
    continueButtonFallbacks: [
      '.ant-modal-content button.ant-btn-primary',
      'button:has-text("Lanjutkan")',
    ],
  },

  // ===== OTP INPUT (Google Authenticator code — single input) =====
  otpInput: {
    modal: '.ant-modal-content',
    input: 'input[placeholder*="OTP"], input[placeholder*="otp"], .ant-modal-content input.ant-input',
    inputFallbacks: [
      '.ant-modal-content input[type="text"]',
      '.ant-modal-content input[type="number"]',
      '.ant-modal-content input.ant-input',
    ],
    submitButton: '.ant-modal-content button.ant-btn-primary',
    submitButtonFallbacks: [
      '.ant-modal-content button[type="submit"]',
      '.ant-modal-footer button.ant-btn-primary',
    ],
  },

  // ===== OTP 6-DIGIT INPUT (Google Authenticator — 6 individual fields) =====
  otpSixDigit: {
    modal: '.ant-modal-content',
    title: '.ant-modal-title',
    // 6 individual <input maxlength="1"> fields
    inputs: 'input.antd-pro-app-cache-src-hocs-with-teapot-handler-components-styles-numberInput',
    inputsFallback: '.ant-modal-content input[maxlength="1"]',
    submitButton: '.ant-modal-footer button.ant-btn-primary',
    submitButtonFallbacks: [
      '.ant-modal-content button.ant-btn-primary',
      'button:has-text("Submit")',
    ],
  },

  // ===== DASHBOARD / AFTER LOGIN =====
  dashboard: {
    // Indicators that login was successful
    sidebar: '.ant-layout-sider, .ant-menu',
    avatar: '.ant-avatar, .antd-pro-components-global-header',
    homeUrl: '/dashboard',
  },

  // ===== REPORT / OVERALL PAGE (/report/overall?) =====
  report: {
    // --- Date Range Picker (Ant Design Calendar) ---
    datePicker: '.ant-calendar-picker',
    datePickerFallbacks: [
      '.ant-calendar-picker-input',
      'span.ant-calendar-picker',
    ],
    // Start/end readonly inputs inside picker
    dateStartInput: '.ant-calendar-range-picker-input:first-child',
    dateEndInput: '.ant-calendar-range-picker-input:last-child',
    // Calendar dropdown container
    calendarContainer: '.ant-calendar-picker-container',
    // Editable date inputs inside calendar dropdown
    calendarStartInput: '.ant-calendar-input:first-of-type',
    calendarEndInput: '.ant-calendar-date-input-wrap .ant-calendar-input',
    // Individual date cells (use title attr for specific dates)
    calendarCell: (title: string) => `td[title="${title}"]`,
    // Today cell
    calendarToday: '.ant-calendar-today',
    // Disabled cells
    calendarDisabled: '.ant-calendar-disabled-cell',

    // --- Game Name Filter (Ant Design Tree Select) ---
    gameFilter: '.ant-select.ant-select-allow-clear',
    gameFilterFallbacks: [
      '.ant-select-selection--multiple',
      '.ant-select.ant-select-enabled.ant-select-allow-clear',
    ],
    gameDropdown: '.ant-select-tree-dropdown, .ant-select-dropdown',
    gameTreeTitle: '.ant-select-tree-title',
    gameTreeCheckbox: '.ant-select-tree-checkbox',

    // --- Username Search ---
    usernameInput: '#userUsername',
    usernameInputFallbacks: [
      'input#userUsername',
      'input[placeholder*="Search username"]',
      '.ant-input-search input.ant-input',
    ],

    // --- Filter / Reset Buttons ---
    filterButton: 'button[type="submit"].ant-btn-primary',
    filterButtonFallbacks: [
      'button.ant-btn-primary:has-text("Filter")',
      'form button[type="submit"]',
    ],
    resetButton: '.antd-pro-app-cache-src-components-multiple-search-input-index-resetFilter',
    resetButtonFallbacks: [
      'button:has-text("Reset")',
      'a:has-text("Reset")',
    ],

    // --- Data Table ---
    table: '.ant-table-bordered',
    tableFallbacks: [
      '.ant-table-wrapper',
      '.ant-table',
    ],
    tableBody: '.ant-table-tbody',
    tableRows: '.ant-table-tbody tr.ant-table-row',
    tableRowByKey: (key: string) => `tr[data-row-key="${key}"]`,
    // Summary row at footer
    summaryRow: 'tr[data-row-key="SUMMARY"]',
    summaryRowFallbacks: [
      '.ant-table-footer tr[data-row-key="SUMMARY"]',
      'tfoot tr[data-row-key="SUMMARY"]',
    ],

    // Cell extraction (0-indexed from first td in row)
    // Col 0 = Username (a tag text), Col 1 = Bet Count (a tag text)
    // Col 2 = User TO, Col 3 = User NTO (span.custom-color-bordered > span)
    cellUsername: 'td:nth-child(1) a',
    cellBetCount: 'td:nth-child(2) a',
    cellUserTO: 'td:nth-child(3) span.custom-color-bordered > span',
    cellUserNTO: 'td:nth-child(4) span.custom-color-bordered > span',

    // --- Pagination ---
    pagination: '.ant-pagination',
    paginationNext: '.ant-pagination-next',
    paginationPrev: '.ant-pagination-prev',
    paginationItem: (page: number) => `.ant-pagination-item[title="${page}"]`,
    paginationTotal: '.ant-pagination-total-text',
    // Page size selector
    paginationSizeChanger: '.ant-pagination-options .ant-select',

    // --- Loading indicator ---
    tableLoading: '.ant-table-loading, .ant-spin-spinning',
    tablePlaceholder: '.ant-table-placeholder',
  },
  // ===== MEMBER MANAGEMENT PAGE =====
  member: {
    // Table selectors (same Ant Design table pattern as report page)
    table: '.ant-table-bordered',
    tableBody: '.ant-table-tbody',
    tableRows: '.ant-table-tbody tr.ant-table-row',
    // Columns (0-indexed): Id(0), Username(1), Name(2), Account Number(3),
    // Referral(4), Wallet(5), Phone(6), Email(7), Referral Code(8),
    // Join Date(9), Last Login(10), Last Login Ip(11), Source(12), Action(13)
    cellId: 'td:nth-child(1)',       // Used for green color status detection
    cellUsername: 'td:nth-child(2)',
    cellWallet: 'td:nth-child(6)',
    cellPhone: 'td:nth-child(7)',
    cellJoinDate: 'td:nth-child(10)',
    // Pagination (reuse same Ant Design pagination)
    pagination: 'ul.ant-pagination',
    paginationNext: '.ant-pagination-next',
    paginationItem: (page: number) => `.ant-pagination-item[title="${page}"]`,
    paginationTotal: '.ant-pagination-total-text',
    // Page size changer
    paginationSizeChanger: '.ant-pagination-options .ant-select',
    // Loading
    tableLoading: '.ant-table-loading, .ant-spin-spinning',
    tablePlaceholder: '.ant-empty-description',
  },
} as const;
