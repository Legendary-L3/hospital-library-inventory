/**
 * sample-data.js
 * ---------------------------------------------------------------------------
 * Example library used by Admin > Data > "Load sample data". It is merged into
 * whatever is already in the browser, so it is safe to try on a live library:
 * sample barcodes use the DEMO prefix and sample ids start with "item_demo_",
 * so they never collide with real LIB barcodes.
 *
 * The object has exactly the same shape as a JSON export (see store.js header).
 * `sample-data.json` in the project root is the same content as a file, for
 * testing the Import button; regenerate it after editing this file with:
 *   node -e "global.window={};require('./js/sample-data.js');console.log(JSON.stringify(window.SampleData,null,2))" > sample-data.json
 *
 * This file is optional. Delete it (and its <script> tag in index.html) for a
 * production deployment if you prefer; the button then disables itself.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // Helper to keep the item list readable: [barcode, title, author, section, format, isbn, year, description, tags]
  const I = (barcode, title, author, section, format, isbn, year, description, tags) => ({
    id: `item_demo_${barcode.toLowerCase()}`,
    barcode, title, author, section, format, isbn, year, description, tags: tags || [],
    location: '', status: 'available', condition: 'Good', notes: '',
    addedAt: '2026-09-01T14:00:00.000Z', updatedAt: '2026-09-01T14:00:00.000Z', labelPrintedAt: '2026-09-02T16:30:00.000Z',
  });

  const items = [
    I('DEMO0001', 'The Alchemist', 'Paulo Coelho', 'Fiction', 'Paperback', '9780062315007', '1988', 'A shepherd boy travels in search of treasure and finds his personal legend.', ['journey', 'inspiration']),
    I('DEMO0002', 'A Man Called Ove', 'Fredrik Backman', 'Fiction', 'Paperback', '9781476738024', '2012', 'A grumpy widower is drawn back into life by his new neighbours.', ['humour', 'community']),
    I('DEMO0003', 'The House in the Cerulean Sea', 'TJ Klune', 'Fiction', 'Hardcover', '9781250217288', '2020', 'A caseworker visits an orphanage of magical children and finds a family.', ['found family', 'uplifting']),
    I('DEMO0004', 'The Thursday Murder Club', 'Richard Osman', 'Mystery & Thriller', 'Paperback', '9781984880987', '2020', 'Four retirees meet weekly to solve cold cases.', ['cozy mystery']),
    I('DEMO0005', 'Still Life', 'Louise Penny', 'Mystery & Thriller', 'Paperback', '9780312541538', '2005', 'Inspector Gamache investigates a death in the village of Three Pines.', ['series']),
    I('DEMO0006', 'The Hobbit', 'J. R. R. Tolkien', 'Science Fiction & Fantasy', 'Paperback', '9780547928227', '1937', 'Bilbo Baggins sets out on an unexpected journey.', ['classic']),
    I('DEMO0007', 'The Martian', 'Andy Weir', 'Science Fiction & Fantasy', 'Paperback', '9780553418026', '2011', 'An astronaut stranded on Mars works the problem.', ['survival', 'humour']),
    I('DEMO0008', 'Beach Read', 'Emily Henry', 'Romance', 'Paperback', '9781984806734', '2020', 'Two rival writers swap genres for a summer.', []),
    I('DEMO0009', 'Sapiens', 'Yuval Noah Harari', 'Non-Fiction', 'Paperback', '9780062316110', '2011', 'A brief history of humankind.', ['history']),
    I('DEMO0010', 'Atomic Habits', 'James Clear', 'Self-Help & Recovery', 'Hardcover', '9780735211292', '2018', 'Small changes, remarkable results.', ['habits']),
    I('DEMO0011', 'Feeling Good: The New Mood Therapy', 'David D. Burns', 'Self-Help & Recovery', 'Paperback', '9780380810338', '1980', 'Cognitive behavioural techniques for depression.', ['CBT', 'depression']),
    I('DEMO0012', 'The Body Keeps the Score', 'Bessel van der Kolk', 'Mental Health & Wellness', 'Paperback', '9780143127741', '2014', 'How trauma affects body and mind, and paths to recovery.', ['trauma']),
    I('DEMO0013', 'Wherever You Go, There You Are', 'Jon Kabat-Zinn', 'Mental Health & Wellness', 'Paperback', '9781401307783', '1994', 'Mindfulness meditation in everyday life.', ['mindfulness']),
    I('DEMO0014', 'The Dialectical Behavior Therapy Skills Workbook', 'Matthew McKay', 'Mental Health & Wellness', 'Paperback', '9781684034581', '2019', 'Practical DBT exercises for distress tolerance and emotion regulation.', ['DBT', 'workbook']),
    I('DEMO0015', 'Man\'s Search for Meaning', 'Viktor E. Frankl', 'Spirituality & Inspiration', 'Paperback', '9780807014271', '1946', 'Finding purpose in the hardest circumstances.', ['meaning']),
    I('DEMO0016', 'Daily Reflections', 'Alcoholics Anonymous', 'Self-Help & Recovery', 'Paperback', '9780916856939', '1990', 'A reading for each day of the year.', ['recovery', 'daily']),
    I('DEMO0017', 'Devotions: The Selected Poems of Mary Oliver', 'Mary Oliver', 'Poetry', 'Hardcover', '9780399563249', '2017', 'Over 200 poems spanning five decades.', []),
    I('DEMO0018', 'Milk and Honey', 'Rupi Kaur', 'Poetry', 'Paperback', '9781449474256', '2014', 'Poetry about survival, love and healing.', []),
    I('DEMO0019', 'Persepolis', 'Marjane Satrapi', 'Graphic Novels & Comics', 'Paperback', '9780375714573', '2003', 'A memoir of growing up in Iran, in comics form.', ['memoir']),
    I('DEMO0020', 'Calvin and Hobbes: The Complete Collection, Vol. 1', 'Bill Watterson', 'Graphic Novels & Comics', 'Hardcover', '9781449433253', '2012', 'A boy and his tiger.', ['humour']),
    I('DEMO0021', 'Big Book of Crossword Puzzles', 'Various', 'Puzzles & Games', 'Puzzle', '', '2021', '300 easy-to-medium crosswords.', ['crossword']),
    I('DEMO0022', 'Sudoku for Relaxation', 'Various', 'Puzzles & Games', 'Puzzle', '', '2020', 'Puzzles from gentle to tricky.', ['sudoku']),
    I('DEMO0023', 'National Geographic - October 2026', 'National Geographic Society', 'Magazines', 'Magazine', '', '2026', '', ['magazine']),
    I('DEMO0024', 'Pride and Prejudice (Large Print)', 'Jane Austen', 'Large Print', 'Large Print', '9781594130854', '1813', 'Elizabeth Bennet meets Mr Darcy.', ['classic']),
    I('DEMO0025', 'Cien años de soledad', 'Gabriel García Márquez', 'Spanish & Other Languages', 'Paperback', '9780307474728', '1967', 'La historia de la familia Buendía en Macondo.', ['español']),
    I('DEMO0026', 'The Perks of Being a Wallflower', 'Stephen Chbosky', 'Young Adult', 'Paperback', '9781451696196', '1999', 'Charlie navigates his first year of high school.', ['coming of age']),
    I('DEMO0027', 'Becoming', 'Michelle Obama', 'Biography & Memoir', 'Paperback', '9781524763145', '2018', 'A memoir by the former First Lady.', []),
    I('DEMO0028', 'The Alchemist', 'Paulo Coelho', 'Fiction', 'Paperback', '9780062315007', '1988', 'Second copy.', ['journey', 'inspiration']),
  ];

  // Loans: two active (one overdue), several returned. Dates are relative to the
  // 2026-10-20 sample snapshot; "active" simply means returnedAt is null.
  const loans = [
    {
      id: 'loan_demo_001', itemId: 'item_demo_demo0010', barcode: 'DEMO0010', titleSnapshot: 'Atomic Habits',
      patronName: 'Jordan Rivera', unit: 'Unit B', roomOrBed: '12-A',
      checkedOutAt: '2026-10-12T15:20:00.000Z', dueAt: '2026-10-27T03:59:59.999Z', returnedAt: null,
      checkedOutVia: 'consumer', returnedVia: null, staffInitials: '', notes: '', returnCondition: '', renewals: 0, outcome: null,
    },
    {
      id: 'loan_demo_002', itemId: 'item_demo_demo0004', barcode: 'DEMO0004', titleSnapshot: 'The Thursday Murder Club',
      patronName: 'Sam Okafor', unit: 'Unit A', roomOrBed: '',
      checkedOutAt: '2026-09-28T18:05:00.000Z', dueAt: '2026-10-13T03:59:59.999Z', returnedAt: null,
      checkedOutVia: 'admin', returnedVia: null, staffInitials: 'KL', notes: 'Patron asked for a mystery.', returnCondition: '', renewals: 0, outcome: null,
    },
    {
      id: 'loan_demo_003', itemId: 'item_demo_demo0012', barcode: 'DEMO0012', titleSnapshot: 'The Body Keeps the Score',
      patronName: 'Alex Chen', unit: 'Unit C', roomOrBed: '',
      checkedOutAt: '2026-09-10T16:00:00.000Z', dueAt: '2026-09-25T03:59:59.999Z', returnedAt: '2026-09-22T14:10:00.000Z',
      checkedOutVia: 'consumer', returnedVia: 'consumer', staffInitials: '', notes: '', returnCondition: '', renewals: 0, outcome: 'returned',
    },
    {
      id: 'loan_demo_004', itemId: 'item_demo_demo0001', barcode: 'DEMO0001', titleSnapshot: 'The Alchemist',
      patronName: 'Jordan Rivera', unit: 'Unit B', roomOrBed: '12-A',
      checkedOutAt: '2026-09-14T13:30:00.000Z', dueAt: '2026-09-29T03:59:59.999Z', returnedAt: '2026-10-01T19:45:00.000Z',
      checkedOutVia: 'consumer', returnedVia: 'admin', staffInitials: 'KL', notes: '', returnCondition: 'Good', renewals: 0, outcome: 'returned',
    },
    {
      id: 'loan_demo_005', itemId: 'item_demo_demo0021', barcode: 'DEMO0021', titleSnapshot: 'Big Book of Crossword Puzzles',
      patronName: 'Priya Natarajan', unit: 'Geriatric Unit', roomOrBed: '4',
      checkedOutAt: '2026-09-18T17:00:00.000Z', dueAt: '2026-10-03T03:59:59.999Z', returnedAt: '2026-10-02T15:00:00.000Z',
      checkedOutVia: 'admin', returnedVia: 'admin', staffInitials: 'MB', notes: '', returnCondition: 'Worn', renewals: 1, outcome: 'returned',
    },
    {
      id: 'loan_demo_006', itemId: 'item_demo_demo0001', barcode: 'DEMO0001', titleSnapshot: 'The Alchemist',
      patronName: 'Taylor Brooks', unit: 'Adolescent Unit', roomOrBed: '',
      checkedOutAt: '2026-10-03T20:00:00.000Z', dueAt: '2026-10-18T03:59:59.999Z', returnedAt: '2026-10-15T18:30:00.000Z',
      checkedOutVia: 'consumer', returnedVia: 'consumer', staffInitials: '', notes: '', returnCondition: '', renewals: 0, outcome: 'returned',
    },
  ];
  // Keep item statuses consistent with the active loans above.
  items.find((i) => i.barcode === 'DEMO0010').status = 'checked_out';
  items.find((i) => i.barcode === 'DEMO0004').status = 'checked_out';

  global.SampleData = {
    schemaVersion: 1,
    exportedAt: '2026-10-20T12:00:00.000Z',
    settings: {
      libraryName: 'Consumer Library',
      usingDefaultPassword: true,
      loanPeriodDays: 14,
      maxLoansPerPatron: 3,
      autoLogoutMinutes: 15,
      barcodePrefix: 'LIB',
      barcodeDigits: 6,
      barcodeSymbology: 'code128',
      barcodeModuleWidth: 2,
      labelLayout: 'sheet30',
      sections: [
        'Fiction', 'Mystery & Thriller', 'Science Fiction & Fantasy', 'Romance', 'Non-Fiction', 'Biography & Memoir',
        'Self-Help & Recovery', 'Mental Health & Wellness', 'Spirituality & Inspiration', 'Poetry', 'Graphic Novels & Comics',
        'Puzzles & Games', 'Magazines', 'Large Print', 'Spanish & Other Languages', 'Young Adult',
      ],
      units: ['Unit A', 'Unit B', 'Unit C', 'Unit D', 'Adolescent Unit', 'Geriatric Unit'],
      formats: ['Book', 'Paperback', 'Hardcover', 'Large Print', 'Magazine', 'Audiobook', 'DVD', 'Puzzle', 'Game', 'Other'],
    },
    items,
    loans,
    activityLog: [
      { at: '2026-09-01T14:00:00.000Z', type: 'data.import', message: 'Sample collection created', data: null },
    ],
    nextBarcodeSeq: 1,
  };
})(window);
