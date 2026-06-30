// Coppermind MediaWiki API configuration
const API_BASE = 'https://coppermind.net/w/api.php';
const WIKI_BASE = 'https://coppermind.net/wiki/';

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const resultsContent = document.getElementById('resultsContent');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const articleModal = document.getElementById('articleModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const wikiLink = document.getElementById('wikiLink');

// Allow Enter key to search
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

// Close modal on backdrop click
articleModal.addEventListener('click', (e) => {
    if (e.target === articleModal) closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    showLoading();
    hideResults();

    try {
        // Step 1: Search for matching pages
        const searchResults = await searchCoppermind(query);
        
        if (searchResults.length === 0) {
            showNoResults(query);
            return;
        }

        // Step 2: Fetch summaries for top results
        const enrichedResults = await enrichResults(searchResults.slice(0, 8));
        
        displayResults(enrichedResults, query);
    } catch (error) {
        console.error('Search error:', error);
        showError();
    } finally {
        hideLoading();
    }
}

async function searchCoppermind(query) {
    const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: 10,
        format: 'json',
        origin: '*'
    });

    const response = await fetch(`${API_BASE}?${params}`);
    const data = await response.json();
    return data.query.search;
}

async function enrichResults(searchResults) {
    const titles = searchResults.map(r => r.title);
    
    // Fetch extracts (summaries) for all results in one batch
    const extractParams = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        titles: titles.join('|'),
        exintro: true,
        exsentences: 5,
        explaintext: true,
        exlimit: 'max',
        format: 'json',
        origin: '*'
    });

    const extractResponse = await fetch(`${API_BASE}?${extractParams}`);
    const extractData = await extractResponse.json();
    const pages = extractData.query.pages;

    // Fetch page info for categories
    const infoParams = new URLSearchParams({
        action: 'query',
        prop: 'info',
        titles: titles.join('|'),
        inprop: 'url',
        format: 'json',
        origin: '*'
    });

    const infoResponse = await fetch(`${API_BASE}?${infoParams}`);
    const infoData = await infoResponse.json();
    const infoPages = infoData.query.pages;

    return searchResults.map(result => {
        const pageId = result.pageid;
        const page = pages[pageId] || {};
        const info = infoPages[pageId] || {};
        
        return {
            ...result,
            extract: page.extract || '',
            fullUrl: info.fullurl || `${WIKI_BASE}${encodeURIComponent(result.title.replace(/ /g, '_'))}`
        };
    });
}

function displayResults(items, query) {
    resultsTitle.textContent = `Results for "${query}"`;
    resultsCount.textContent = `${items.length} found`;
    
    resultsContent.innerHTML = items.map(item => `
        <div class="result-card" onclick="openArticle('${escapeJsString(item.title)}')">
            <h3>${escapeHtml(item.title)}</h3>
            <div class="summary">${escapeHtml(summarizeText(item.extract || item.snippet))}</div>
            <div class="meta">
                <span>📄 ${(item.wordcount || 0).toLocaleString()} words</span>
                <span>🔗 ${escapeHtml(item.title)}</span>
            </div>
        </div>
    `).join('');

    showResults();
}

function summarizeText(text) {
    if (!text) return 'No summary available.';
    
    // Clean up wiki markup remnants
    text = text
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/\[\[.*?\|(.*?)\]\]/g, '$1')
        .replace(/\[\[(.*?)\]\]/g, '$1')
        .replace(/'''?(.*?)'''?/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Limit to ~300 chars for card preview
    if (text.length > 300) {
        text = text.substring(0, 300).replace(/[^\s]*$/, '') + '...';
    }
    
    return text || 'No summary available.';
}

async function openArticle(title) {
    showModalLoading();
    
    try {
        // Fetch full article content
        const params = new URLSearchParams({
            action: 'query',
            prop: 'extracts',
            titles: title,
            exsentences: 30,
            explaintext: true,
            format: 'json',
            origin: '*'
        });

        const response = await fetch(`${API_BASE}?${params}`);
        const data = await response.json();
        const pages = data.query.pages;
        const page = Object.values(pages)[0];

        modalTitle.textContent = page.title;
        modalBody.innerHTML = formatArticleContent(page.extract || 'No content available.');
        wikiLink.href = `${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`;
        
        articleModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error loading article:', error);
        modalBody.innerHTML = '<p style="color: #c44;">Failed to load article content.</p>';
        articleModal.classList.remove('hidden');
    }
}

function formatArticleContent(text) {
    if (!text) return '<p>No content available.</p>';
    
    // Clean wiki markup
    text = text
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/\[\[.*?\|(.*?)\]\]/g, '$1')
        .replace(/\[\[(.*?)\]\]/g, '<em>$1</em>')
        .replace(/'''?(.*?)'''?/g, '<strong>$1</strong>');
    
    // Split into paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    
    return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function closeModal() {
    articleModal.classList.add('hidden');
    document.body.style.overflow = '';
}

function showLoading() {
    loading.classList.remove('hidden');
    searchBtn.disabled = true;
    searchBtn.style.opacity = '0.6';
}

function hideLoading() {
    loading.classList.add('hidden');
    searchBtn.disabled = false;
    searchBtn.style.opacity = '1';
}

function showResults() {
    results.classList.remove('hidden');
}

function hideResults() {
    results.classList.add('hidden');
}

function showNoResults(query) {
    resultsTitle.textContent = 'No Results';
    resultsCount.textContent = '';
    resultsContent.innerHTML = `
        <div class="no-results">
            <h3>No matches found</h3>
            <p>No articles on the Coppermind matched "${escapeHtml(query)}".<br>Try a different search term.</p>
        </div>
    `;
    showResults();
}

function showError() {
    resultsTitle.textContent = 'Error';
    resultsCount.textContent = '';
    resultsContent.innerHTML = `
        <div class="no-results">
            <h3>Something went wrong</h3>
            <p>Unable to reach the Coppermind. Please check your connection and try again.</p>
        </div>
    `;
    showResults();
}

function showModalLoading() {
    modalTitle.textContent = 'Loading...';
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeJsString(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
