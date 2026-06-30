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
const aiAnswer = document.getElementById('aiAnswer');
const aiAnswerContent = document.getElementById('aiAnswerContent');
const aiAnswerSources = document.getElementById('aiAnswerSources');
const summarySection = document.getElementById('summarySection');
const summaryContent = document.getElementById('summaryContent');
const articleModal = document.getElementById('articleModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const wikiLink = document.getElementById('wikiLink');

// Question patterns for specific queries
const QUESTION_PATTERNS = {
    birth: {
        keywords: ['born', 'birth', 'birthday', 'date of birth', 'when was', 'born on'],
        extract: (text, title) => extractDateInfo(text, title, 'born', 'birth')
    },
    death: {
        keywords: ['died', 'death', 'when did', 'pass away', 'killed'],
        extract: (text, title) => extractDateInfo(text, title, 'died', 'death')
    },
    age: {
        keywords: ['how old', 'age', 'years old'],
        extract: (text, title) => extractAgeInfo(text, title)
    },
    abilities: {
        keywords: ['powers', 'abilities', 'can do', 'magic', 'allomancy', 'surgebinding', 'feruchemy', 'investiture'],
        extract: (text, title) => extractAbilitiesInfo(text, title)
    },
    appearance: {
        keywords: ['look like', 'appearance', 'describe', 'looks', 'hair', 'eyes', 'tall'],
        extract: (text, title) => extractAppearanceInfo(text, title)
    },
    family: {
        keywords: ['family', 'parents', 'father', 'mother', 'siblings', 'brother', 'sister', 'related to'],
        extract: (text, title) => extractFamilyInfo(text, title)
    },
    occupation: {
        keywords: ['job', 'work', 'occupation', 'profession', 'role', 'position', 'soldier', 'knight'],
        extract: (text, title) => extractOccupationInfo(text, title)
    },
    world: {
        keywords: ['from', 'planet', 'world', 'where', 'location', 'homeworld', 'realm'],
        extract: (text, title) => extractWorldInfo(text, title)
    },
    book: {
        keywords: ['in which book', 'first appearance', 'appears in', 'featured in', 'book'],
        extract: (text, title) => extractBookInfo(text, title)
    }
};

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
    hideAiAnswer();
    hideSummary();

    try {
        // Step 1: Determine if this is a specific question
        const questionType = detectQuestionType(query);
        
        // Step 2: Search for matching pages
        const searchResults = await searchCoppermind(query);
        
        if (searchResults.length === 0) {
            showNoResults(query);
            return;
        }

        // Step 3: Fetch full content for top results
        const enrichedResults = await enrichResults(searchResults.slice(0, 8));
        
        // Step 4: Generate AI answer if it's a specific question
        if (questionType) {
            const answer = generateAnswer(query, enrichedResults, questionType);
            displayAiAnswer(answer, enrichedResults);
        }
        
        // Step 5: Generate overall summary
        const overallSummary = generateOverallSummary(enrichedResults, query);
        displaySummary(overallSummary);
        
        // Step 6: Display individual results
        displayResults(enrichedResults, query);
    } catch (error) {
        console.error('Search error:', error);
        showError();
    } finally {
        hideLoading();
    }
}

function detectQuestionType(query) {
    const lowerQuery = query.toLowerCase();
    
    for (const [type, config] of Object.entries(QUESTION_PATTERNS)) {
        if (config.keywords.some(kw => lowerQuery.includes(kw))) {
            return { type, config };
        }
    }
    
    // Check for "who is", "what is", "tell me about" patterns
    if (/^(who|what|tell me about|describe)/i.test(lowerQuery)) {
        return { type: 'general', config: null };
    }
    
    return null;
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
    
    // Fetch extracts for all results
    const extractParams = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        titles: titles.join('|'),
        exintro: false,
        exchars: 3000,
        explaintext: true,
        exlimit: 'max',
        format: 'json',
        origin: '*'
    });

    const extractResponse = await fetch(`${API_BASE}?${extractParams}`);
    const extractData = await extractResponse.json();
    const pages = extractData.query.pages;

    // Fetch info for URLs
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

function generateAnswer(query, results, questionType) {
    const { type, config } = questionType;
    
    // Try to find the most relevant result (usually the first one for character queries)
    const mainResult = results[0];
    const text = mainResult.extract || '';
    
    let answer = '';
    let confidence = 'high';
    let sources = [mainResult.title];
    
    if (type === 'general') {
        // For "who is" / "what is" questions
        answer = generateGeneralAnswer(text, mainResult.title);
    } else if (config) {
        answer = config.extract(text, mainResult.title);
    }
    
    // If no specific answer found, try other results
    if (!answer || answer.includes('not found') || answer.includes('unclear')) {
        for (let i = 1; i < Math.min(results.length, 3); i++) {
            const fallback = results[i];
            const fallbackText = fallback.extract || '';
            let fallbackAnswer = '';
            
            if (type === 'general') {
                fallbackAnswer = generateGeneralAnswer(fallbackText, fallback.title);
            } else if (config) {
                fallbackAnswer = config.extract(fallbackText, fallback.title);
            }
            
            if (fallbackAnswer && !fallbackAnswer.includes('not found')) {
                answer = fallbackAnswer;
                sources.push(fallback.title);
                confidence = 'medium';
                break;
            }
        }
    }
    
    if (!answer) {
        answer = `I couldn't find a specific answer to "${query}" in the Coppermind. Try rephrasing your question or browse the results below.`;
        confidence = 'low';
    }
    
    return { answer, confidence, sources, type };
}

function generateGeneralAnswer(text, title) {
    // Clean and get first substantial paragraph
    const cleanText = cleanWikiText(text);
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    if (sentences.length === 0) return `Information about ${title} is limited in the available excerpts.`;
    
    // Get first 2-3 sentences that introduce the subject
    const intro = sentences.slice(0, 3).join('. ') + '.';
    return `${title} is ${intro}`;
}

function extractDateInfo(text, title, verb, noun) {
    const cleanText = cleanWikiText(text);
    
    // Look for date patterns
    const patterns = [
        new RegExp(`${title}\\s+(?:is|was)\\s+(?:born|${verb})\\s+(?:on\\s+)?([A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}|\\d{4}|in\\s+\\d{4})`, 'i'),
        new RegExp(`(?:born|${verb})\\s+(?:on\\s+)?([A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}|\\d{4}|in\\s+\\d{4})`, 'i'),
        new RegExp(`(?:born|${verb})\\s+(?:in|on)\\s+([A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}|\\d{4})`, 'i'),
        /(\d{4})\s*(?:AD|CE)?\s*(?:on\s+)?([A-Za-z]+\s+\d{1,2})?/i
    ];
    
    for (const pattern of patterns) {
        const match = cleanText.match(pattern);
        if (match) {
            const date = match[1] || match[0];
            if (verb === 'died') {
                return `${title} died on ${date.trim()}.`;
            }
            return `${title} was born on ${date.trim()}.`;
        }
    }
    
    // Look for age references
    const ageMatch = cleanText.match(new RegExp(`${title}\\s+(?:is|was)\\s+(\\d+)\\s+years?\\s+old`, 'i'));
    if (ageMatch) {
        return `${title} is ${ageMatch[1]} years old (exact birth date not specified in the excerpt).`;
    }
    
    return `The exact ${noun} date of ${title} was not found in the available excerpts.`;
}

function extractAgeInfo(text, title) {
    const cleanText = cleanWikiText(text);
    
    // Look for explicit age mentions
    const agePatterns = [
        new RegExp(`${title}\\s+(?:is|was)\\s+(\\d+)\\s+years?\\s+old`, 'i'),
        /(\d+)\s*years?\s*old/i,
        /age(?:d)?\s+(\d+)/i,
        /(?:is|was)\s+(\d+)\s*(?:at\s+the\s+time|during)/i
    ];
    
    for (const pattern of agePatterns) {
        const match = cleanText.match(pattern);
        if (match) {
            return `${title} is ${match[1]} years old.`;
        }
    }
    
    // Try to infer from birth/death dates
    const birthMatch = cleanText.match(/born\s+(?:in\s+)?(\d{4})/i);
    if (birthMatch) {
        const birthYear = parseInt(birthMatch[1]);
        const currentYear = 1175; // Approximate Stormlight Archive present
        const age = currentYear - birthYear;
        return `${title} was born in ${birthYear}, making them approximately ${age} years old during the events of the Stormlight Archive.`;
    }
    
    return `The exact age of ${title} was not found in the available excerpts.`;
}

function extractAbilitiesInfo(text, title) {
    const cleanText = cleanWikiText(text).toLowerCase();
    
    const abilities = [];
    const abilityKeywords = {
        'Allomancy': ['allomancer', 'allomancy', 'burns', 'metal'],
        'Feruchemy': ['feruchemist', 'feruchemy', 'metalmind', 'stores'],
        'Surgebinding': ['surgebinder', 'surgebinding', 'knight radiant', 'radiant', 'spren'],
        'Awakening': ['awakener', 'awakening', 'breath', 'biochroma'],
        'AonDor': ['aondor', 'elantrian', 'aons', 'sel'],
        'Sand Mastery': ['sand master', 'sand mastery'],
        'Shardblade': ['shardblade', 'honorblade'],
        'Shardplate': ['shardplate'],
        'Compounding': ['compounding', 'compound'],
        'Hemalurgy': ['hemalurgist', 'hemalurgy', 'spike'],
        'Regal': ['regal', 'stormform'],
        'Dakhor': ['dakhor', 'monk'],
        'ChayShan': ['chayshan'],
        'Forgery': ['forger', 'forgery', 'soulstamp']
    };
    
    for (const [ability, keywords] of Object.entries(abilityKeywords)) {
        if (keywords.some(kw => cleanText.includes(kw))) {
            abilities.push(ability);
        }
    }
    
    if (abilities.length > 0) {
        return `${title} possesses the following abilities: ${abilities.join(', ')}.`;
    }
    
    // Look for general power descriptions
    const powerMatch = cleanText.match(/(?:has|possesses|wields|uses|commands|controls)\s+([^.,;]+(?:power|ability|magic|force|energy)[^.,;]*)/i);
    if (powerMatch) {
        return `${title} ${powerMatch[0]}.`;
    }
    
    return `No specific abilities were found for ${title} in the available excerpts.`;
}

function extractAppearanceInfo(text, title) {
    const cleanText = cleanWikiText(text);
    
    const appearancePatterns = [
        new RegExp(`${title}\\s+(?:is|was)\\s+(?:a\\s+)?([^.,;]{10,80}?(?:tall|short|muscular|slender|thin|heavy|broad|lean)[^.,;]{0,60})`, 'i'),
        /(?:has|with|wearing)\s+([^.,;]{10,100}?(?:hair|eyes|skin|face|beard|build|figure)[^.,;]{0,60})/i,
        /(?:dark|light|pale|tan|black|brown|blond|red|white|grey|blue|green|hazel)\s+(?:hair|eyes|skin)/i
    ];
    
    for (const pattern of appearancePatterns) {
        const match = cleanText.match(pattern);
        if (match) {
            const desc = match[1] || match[0];
            return `${title} ${desc.trim()}.`;
        }
    }
    
    // Look for physical description in first paragraph
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    for (const sentence of sentences.slice(0, 5)) {
        const lower = sentence.toLowerCase();
        if (lower.includes('hair') || lower.includes('eyes') || lower.includes('tall') || 
            lower.includes('appearance') || lower.includes('look')) {
            return `${title} ${sentence.trim()}.`;
        }
    }
    
    return `Detailed appearance information for ${title} was not found in the available excerpts.`;
}

function extractFamilyInfo(text, title) {
    const cleanText = cleanWikiText(text);
    
    const familyPatterns = [
        new RegExp(`${title}(?:'s)?\\s+(?:father|mother|parent)\\s+(?:is|was)\\s+([^.,;]{3,40})`, 'i'),
        new RegExp(`(?:father|mother|parent)\\s+(?:is|was)\\s+([^.,;]{3,40})[.,;]`, 'i'),
        new RegExp(`(?:brother|sister|sibling)\\s+(?:is|was|named)\\s+([^.,;]{3,40})`, 'i'),
        new RegExp(`(?:married|wife|husband|spouse)\\s+(?:to|of|is|was)?\\s*([^.,;]{3,40})`, 'i'),
        new RegExp(`(?:son|daughter|child)\\s+(?:of|to)\\s+([^.,;]{3,40})`, 'i')
    ];
    
    const familyMembers = [];
    for (const pattern of familyPatterns) {
        const match = cleanText.match(pattern);
        if (match) {
            const relation = match[0].match(/(father|mother|brother|sister|wife|husband|son|daughter|spouse)/i)?.[0] || 'relative';
            familyMembers.push(`${relation}: ${match[1].trim()}`);
        }
    }
    
    if (familyMembers.length > 0) {
        return `${title}'s family includes: ${familyMembers.join('; ')}.`;
    }
    
    return `Family information for ${title} was not found in the available excerpts.`;
}

function extractOccupationInfo(text, title) {
    const cleanText = cleanWikiText(text).toLowerCase();
    
    const occupations = [];
    const occupationKeywords = {
        'Soldier': ['soldier', 'warrior', 'fighter', 'spearman', 'swordsman'],
        'Knight Radiant': ['knight radiant', 'radiant'],
        'Noble': ['noble', 'lord', 'lady', 'highprince', 'king', 'queen'],
        'Scholar': ['scholar', 'ardent', 'researcher', 'scientist'],
        'Merchant': ['merchant', 'trader', 'merchantlord'],
        'Thief': ['thief', 'crewleader', 'criminal'],
        'Spy': ['spy', 'informant', 'operative'],
        'Emperor': ['emperor', 'empress', 'ruler'],
        'Soldier': ['soldier', 'spearman', 'bridgeman', 'soldier'],
        'Surgeon': ['surgeon', 'healer', 'doctor'],
        'Writer': ['writer', 'author', 'poet'],
        'Artist': ['artist', 'painter', 'musician'],
        'Engineer': ['engineer', 'artifabrian', 'mechanic']
    };
    
    for (const [job, keywords] of Object.entries(occupationKeywords)) {
        if (keywords.some(kw => cleanText.includes(kw))) {
            occupations.push(job);
        }
    }
    
    // Look for explicit role descriptions
    const roleMatch = cleanText.match(/(?:is|was|serves? as|works? as|acts? as)\s+(?:a|an|the)?\s+([^.,;]{5,50}?(?:leader|captain|commander|general|lord|lady|king|queen|emperor|scholar|merchant|thief|spy|soldier|surgeon)[^.,;]{0,30})/i);
    if (roleMatch) {
        const role = roleMatch[1].trim();
        if (!occupations.includes(role)) occupations.push(role);
    }
    
    if (occupations.length > 0) {
        const unique = [...new Set(occupations)];
        return `${title} is ${unique.join(', ')}.`;
    }
    
    return `Occupation information for ${title} was not found in the available excerpts.`;
}

function extractWorldInfo(text, title) {
    const cleanText = cleanWikiText(text).toLowerCase();
    
    const worlds = {
        'Roshar': ['roshar', 'alethkar', 'jah keved', 'shadesmar', 'urithiru', 'kholin'],
        'Scadrial': ['scadrial', 'final empire', 'elendel', 'basin', 'southern scadrial'],
        'Nalthis': ['nalthis', 'hallandren', 't''telir', 'idris'],
        'Sel': ['sel', 'elantris', 'fjorden', 'aedon', 'rose empire'],
        'Taldain': ['taldain', 'dayside', 'darkside', 'kezare'],
        'Threnody': ['threnody', 'forest of hell', 'homeland'],
        'First of the Sun': ['first of the sun', 'pantheon', 'patji'],
        'Yolen': ['yolen']
    };
    
    const foundWorlds = [];
    for (const [world, keywords] of Object.entries(worlds)) {
        if (keywords.some(kw => cleanText.includes(kw))) {
            foundWorlds.push(world);
        }
    }
    
    if (foundWorlds.length > 0) {
        return `${title} is from ${foundWorlds.join(' / ')}.`;
    }
    
    // Look for "from" patterns
    const fromMatch = cleanText.match(new RegExp(`${title}\\s+(?:is|was|comes|hails)\\s+(?:from|of)\\s+([A-Za-z]+)`, 'i'));
    if (fromMatch) {
        return `${title} is from ${fromMatch[1]}.`;
    }
    
    return `World/origin information for ${title} was not found in the available excerpts.`;
}

function extractBookInfo(text, title) {
    const cleanText = cleanWikiText(text);
    
    const bookPatterns = [
        /(?:appears?|featured?|introduced?|first seen|debut)\s+(?:in|in the book)?\s*["']?([^"']{5,60}?)["']?/i,
        /(?:from|in)\s+(?:the\s+book\s+)?["']?([^"']{5,60}?)["']?/i,
        /(?:The\s+Way\s+of\s+Kings|Words\s+of\s+Radiance|Oathbringer|Rhythm\s+of\s+War|Wind\s+and\s+Truth|Elantris|Mistborn|The\s+Final\s+Empire|The\s+Well\s+of\s+Ascension|The\s+Hero\s+of\s+Ages|Warbreaker|Shadows\s+of\s+Self|The\s+Bands\s+of\s+Mourning)/gi
    ];
    
    const books = [];
    for (const pattern of bookPatterns) {
        const matches = cleanText.matchAll(pattern);
        for (const match of matches) {
            const book = (match[1] || match[0]).trim();
            if (book.length > 3 && !books.includes(book)) {
                books.push(book);
            }
        }
    }
    
    if (books.length > 0) {
        return `${title} appears in: ${books.slice(0, 5).join(', ')}.`;
    }
    
    return `Book appearance information for ${title} was not found in the available excerpts.`;
}

function generateOverallSummary(results, query) {
    if (results.length === 0) return '';
    
    const titles = results.map(r => r.title);
    const mainTopics = titles.slice(0, 3).join(', ');
    
    // Collect key facts from all results
    const allExtracts = results.map(r => cleanWikiText(r.extract || '')).join(' ');
    const sentences = allExtracts.split(/[.!?]+/).filter(s => s.trim().length > 30);
    
    // Find the most informative sentences
    const keySentences = [];
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    for (const sentence of sentences) {
        const lower = sentence.toLowerCase();
        const relevance = queryWords.filter(w => lower.includes(w)).length;
        if (relevance > 0 && keySentences.length < 5) {
            keySentences.push({ text: sentence.trim(), relevance });
        }
    }
    
    // Sort by relevance
    keySentences.sort((a, b) => b.relevance - a.relevance);
    
    let summary = `<p>Your search for "<strong>${escapeHtml(query)}</strong>" returned ${results.length} results from the Coppermind. `;
    summary += `The most relevant topics include <strong>${escapeHtml(mainTopics)}</strong>.</p>`;
    
    if (keySentences.length > 0) {
        summary += `<p><strong>Key findings across all results:</strong></p><ul>`;
        for (const sent of keySentences.slice(0, 4)) {
            summary += `<li>${escapeHtml(sent.text)}.</li>`;
        }
        summary += `</ul>`;
    }
    
    summary += `<p>Click on any result below to read more details, or view the full article on the Coppermind.</p>`;
    
    return summary;
}

function cleanWikiText(text) {
    if (!text) return '';
    return text
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/\[\[.*?\|(.*?)\]\]/g, '$1')
        .replace(/\[\[(.*?)\]\]/g, '$1')
        .replace(/'''?(.*?)'''?/g, '$1')
        .replace(/==+.*?==+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function displayAiAnswer(answerData, results) {
    const { answer, confidence, sources, type } = answerData;
    
    let confidenceClass = 'answer-highlight';
    if (confidence === 'medium') confidenceClass = 'answer-highlight';
    if (confidence === 'low') confidenceClass = 'answer-uncertain';
    
    aiAnswerContent.innerHTML = `<span class="${confidenceClass}">${escapeHtml(answer)}</span>`;
    
    const sourceLinks = sources.map(s => 
        `<a href="${WIKI_BASE}${encodeURIComponent(s.replace(/ /g, '_'))}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`
    ).join(', ');
    
    aiAnswerSources.innerHTML = `Sources: ${sourceLinks} ${confidence !== 'high' ? '• Confidence: ' + confidence : ''}`;
    
    aiAnswer.classList.remove('hidden');
}

function displaySummary(summaryHtml) {
    summaryContent.innerHTML = summaryHtml;
    summarySection.classList.remove('hidden');
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
    
    const clean = cleanWikiText(text);
    
    if (clean.length > 300) {
        return clean.substring(0, 300).replace(/[^\s]*$/, '') + '...';
    }
    
    return clean || 'No summary available.';
}

async function openArticle(title) {
    showModalLoading();
    
    try {
        const params = new URLSearchParams({
            action: 'query',
            prop: 'extracts',
            titles: title,
            exchars: 8000,
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
    
    const clean = text
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/\[\[.*?\|(.*?)\]\]/g, '$1')
        .replace(/\[\[(.*?)\]\]/g, '<em>$1</em>')
        .replace(/'''?(.*?)'''?/g, '<strong>$1</strong>');
    
    const paragraphs = clean.split(/\n\s*\n/).filter(p => p.trim());
    
    return paragraphs.map(p => {
        if (p.trim().startsWith('==')) {
            const heading = p.replace(/==+/g, '').trim();
            return `<h3 style="color: var(--copper-light); margin: 20px 0 10px; font-family: Cinzel, serif;">${escapeHtml(heading)}</h3>`;
        }
        return `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');
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

function hideAiAnswer() {
    aiAnswer.classList.add('hidden');
}

function hideSummary() {
    summarySection.classList.add('hidden');
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
