/**
 * Victory Panel Selectors
 * Based on Material UI (MUI) React SPA at vepanel.club
 */
export const VICTORY_SELECTORS = {
  // ===== LOGIN PAGE =====
  login: {
    username: '#username',
    usernameFallbacks: [
      'input#username',
      'input[name="username"]',
      'input[type="text"]',
    ],

    password: '#password',
    passwordFallbacks: [
      'input#password',
      'input[name="password"]',
      'input[type="password"]',
    ],

    submitButton: '#Login_Button_signin',
    submitButtonFallbacks: [
      'button#Login_Button_signin',
      'button[type="submit"]',
      'button:has-text("Sign In")',
      'button:has-text("Login")',
    ],

    // Error indicators
    errorMessage: '.MuiAlert-root, .MuiAlert-standardError, .MuiSnackbar-root',
  },

  // ===== DASHBOARD / AFTER LOGIN =====
  dashboard: {
    appBar: '.MuiAppBar-root',
    drawer: '.MuiDrawer-root',
    sidebar: '.MuiDrawer-root, .MuiAppBar-root',
    toolbar: '.MuiToolbar-root',
  },

  // ===== REPORT PAGE (/report/report-profit-loss/by-player) =====
  report: {
    // --- Date Pickers (MUI DatePicker) ---
    startDate: '#ReportFilter_DatePicker_startdate',
    startDateFallbacks: [
      'input#ReportFilter_DatePicker_startdate',
      '[id="ReportFilter_DatePicker_startdate"]',
    ],

    endDate: '#ReportFilter_DatePicker_enddate',
    endDateFallbacks: [
      'input#ReportFilter_DatePicker_enddate',
      '[id="ReportFilter_DatePicker_enddate"]',
    ],

    // --- Username Search ---
    usernameInput: 'input[name="username"]',
    usernameInputFallbacks: [
      'input[placeholder*="username" i]',
      'input[placeholder*="Username"]',
    ],

    // --- Filter Button (MUI Button type="submit" with text "Filter") ---
    filterButton: 'button.MuiButton-containedError[type="submit"]',
    filterButtonFallbacks: [
      'button[type="submit"]:has-text("Filter")',
      'button.MuiButton-contained[type="submit"]',
      'button.MuiButton-root[type="submit"]',
    ],

    // --- Data Table (MUI Table) ---
    tableContainer: '.MuiTableContainer-root',
    tableBody: '.MuiTableBody-root, tbody.MuiTableBody-root',
    tableRow: (n: number) => `[data-testid="tablerow-${n}"]`,

    // Cell extraction via data-testid
    cellUsername: (n: number) => `[data-testid="tablerow-${n}-username"]`,
    cellBetCount: (n: number) => `[data-testid="tablerow-${n}-bet_count"]`,
    cellValidBet: (n: number) => `[data-testid="tablerow-${n}-valid_bet_amount"]`,
    cellPlayerWinLoss: (n: number) => `[data-testid="tablerow-${n}-player_winloss_amount"]`,
    cellTotalWinLoss: (n: number) => `[data-testid="tablerow-${n}-total_winloss_amount"]`,

    // Footer totals
    footerValidBet: '[data-testid="tablefooter-valid_bet_amount"]',
    footerPlayerWinLoss: '[data-testid="tablefooter-player_winloss_amount"]',
    footerTotalWinLoss: '[data-testid="tablefooter-total_winloss_amount"]',

    // --- Loading ---
    loadingSpinner: '.MuiCircularProgress-root',
    loadingOverlay: '.MuiBackdrop-root',

    // --- Pagination (MUI TablePagination) ---
    pagination: '.MuiTablePagination-root',
    paginationNextButton: '.MuiTablePagination-actions button:last-child',
    paginationPrevButton: '.MuiTablePagination-actions button:first-child',
    paginationDisplayedRows: '.MuiTablePagination-displayedRows',

    // --- No Data ---
    noDataMessage: '.MuiTableBody-root tr td[colspan]',
  },
} as const;
