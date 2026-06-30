const API_BASE = 'https://coppermind.net/w/api.php';
const WIKI_BASE = 'https://coppermind.net/wiki/';

// Conversation state
let conversationHistory = [];
let currentContext = { lastEntity: null };

// DOM
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const typingIndicator = document.getElementById('typingIndicator');

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function askSuggestion(text) {
    chatInput.value = text;
    sendMessage();
}

function startNewChat() {
    conversationHistory = [];
    currentContext = { lastEntity: null };
    chatMessages.innerHTML = `
        <div class="message bot-message">
            <div class="avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
            </div>
            <div class="message-content">
                <p>Greetings, traveler. I am the Coppermind Scholar, a keeper of knowledge from Brandon Sanderson's Cosmere. Ask me about characters, magic systems, worlds, or events — I shall search the archives and reveal what I find.</p>
                <span class="timestamp">Now</span>
            </div>
        </div>
    `;
    chatInput.focus();
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    chatInput.value = '';
    chatInput.disabled = true;
    sendBtn.disabled = true;
    showTyping();

    try {
        const answer = await processQuestion(text);
        hideTyping();
        addMessage(answer.text, 'bot', answer.meta);
    } catch (err) {
        console.error(err);
        hideTyping();
        addMessage("I apologize — the spren are being uncooperative and I cannot reach the Coppermind archives at the moment. Please try again shortly.", 'bot');
    }

    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

function addMessage(text, sender, meta = null) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let metaHtml = '';
    if (meta) {
        if (meta.sources && meta.sources.length > 0) {
            const links = meta.sources.map(s => 
                `<a class="citation" href="${WIKI_BASE}${encodeURIComponent(s.replace(/ /g, '_'))}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`
            ).join('');
            metaHtml += `<div style="margin-top:10px;">Sources: ${links}</div>`;
        }
        if (meta.confidence) {
            const confText = meta.confidence === 'high' ? 'High confidence' : 
                           meta.confidence === 'medium' ? 'Moderate confidence' : 'Low confidence — verify independently';
            metaHtml += `<span class="confidence">${confText}</span>`;
        }
    }

    div.innerHTML = `
        <div class="avatar">
            ${sender === 'bot' ? 
                `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>` : ''
            }
        </div>
        <div class="message-content">
            <div class="message-text">${text}</div>
            ${metaHtml}
            <span class="timestamp">${time}</span>
        </div>
    `;
    
    chatMessages.appendChild(div);
    scrollToBottom();
    conversationHistory.push({ sender, text });
}

function showTyping() {
    typingIndicator.classList.remove('hidden');
    scrollToBottom();
}

function hideTyping() {
    typingIndicator.classList.add('hidden');
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==================== CORE INTELLIGENCE ====================

async function processQuestion(query) {
    // Handle follow-ups
    let processedQuery = query;
    if (/^(what about|and|what|how about|tell me more|who else|where else|why|how|when|what is|who is|describe)/i.test(query) && currentContext.lastEntity) {
        processedQuery = query + ' ' + currentContext.lastEntity;
    }

    // Step 1: Extract what the user is asking about
    const entity = extractEntity(processedQuery);
    
    // Step 2: Search for articles
    const searchResults = await searchCoppermind(entity || processedQuery);
    
    if (searchResults.length === 0) {
        return {
            text: `<p>I searched the Coppermind but could find no records matching your query. Could you try rephrasing, or check the spelling of names? The archives are vast but exact names help greatly.</p>`,
            meta: { confidence: 'low', sources: [] }
        };
    }

    // Step 3: Fetch full articles
    const articles = await fetchArticles(searchResults.slice(0, 5).map(r => r.title));
    
    if (articles.length === 0) {
        return {
            text: `<p>I found references but could not retrieve the full texts. The archives may be temporarily inaccessible.</p>`,
            meta: { confidence: 'low', sources: [] }
        };
    }

    // Update context
    currentContext.lastEntity = articles[0].title;

    // Step 4: Analyze what information exists and answer generically
    const answer = await generateGenericAnswer(query, articles);
    
    return answer;
}

function extractEntity(query) {
    // Remove common question words and filler
    const stopWords = new Set([
        'who', 'what', 'when', 'where', 'why', 'how', 'is', 'was', 'are', 'were', 
        'did', 'does', 'do', 'can', 'could', 'would', 'should', 'will', 'shall',
        'tell', 'me', 'about', 'explain', 'define', 'describe', 'the', 'a', 'an',
        'this', 'that', 'these', 'those', 'there', 'their', 'they', 'them', 'it',
        'its', 'his', 'her', 'he', 'she', 'we', 'us', 'our', 'you', 'your',
        'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because', 'since',
        'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
        'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
        'have', 'has', 'had', 'having', 'be', 'been', 'being', 'am', 'get', 'got',
        'like', 'look', 'seem', 'appear', 'called', 'named', 'known', 'referred',
        'much', 'many', 'some', 'any', 'all', 'most', 'more', 'less', 'very',
        'really', 'actually', 'probably', 'maybe', 'perhaps', 'just', 'only',
        'also', 'too', 'even', 'still', 'yet', 'already', 'almost', 'quite',
        'rather', 'pretty', 'fairly', 'somewhat', 'kind', 'sort', 'type'
    ]);

    const words = query.split(/\s+/);
    const candidates = [];
    let currentPhrase = [];
    
    for (const word of words) {
        const clean = word.replace(/[.,;:!?'"()[\]{}]/g, '').toLowerCase();
        if (stopWords.has(clean) || clean.length < 2) {
            if (currentPhrase.length > 0) {
                candidates.push(currentPhrase.join(' '));
                currentPhrase = [];
            }
            continue;
        }
        currentPhrase.push(word);
    }
    if (currentPhrase.length > 0) candidates.push(currentPhrase.join(' '));

    // Score candidates: prefer capitalized, longer phrases, proper nouns
    const scored = candidates.map(phrase => {
        const words_in_phrase = phrase.split(/\s+/);
        const capitalized = words_in_phrase.filter(w => /^[A-Z]/.test(w)).length;
        const hasLowercaseStart = /^[a-z]/.test(phrase);
        let score = phrase.length;
        score += capitalized * 15;
        score += words_in_phrase.length * 5;
        if (hasLowercaseStart && words_in_phrase.length === 1) score -= 20;
        if (phrase.includes('?')) score -= 10;
        return { phrase, score };
    });

    scored.sort((a, b) => b.score - a.score);
    
    if (scored.length > 0 && scored[0].phrase.length > 1) {
        return scored[0].phrase;
    }
    
    return query.replace(/\?$/, '').trim();
}

async function searchCoppermind(query) {
    const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: 8,
        format: 'json',
        origin: '*'
    });
    
    const res = await fetch(`${API_BASE}?${params}`);
    const data = await res.json();
    return data.query.search || [];
}

async function fetchArticles(titles) {
    if (titles.length === 0) return [];
    
    const extractParams = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        titles: titles.join('|'),
        exchars: 6000,
        explaintext: true,
        exlimit: 'max',
        format: 'json',
        origin: '*'
    });
    
    const res = await fetch(`${API_BASE}?${extractParams}`);
    const data = await res.json();
    const pages = data.query.pages;
    
    return Object.values(pages).map(page => ({
        title: page.title,
        extract: page.extract || '',
        pageId: page.pageid
    }));
}

// ==================== GENERIC ANSWER GENERATION ====================

async function generateGenericAnswer(query, articles) {
    const mainArticle = articles[0];
    const mainText = cleanText(mainArticle.extract || '');
    const title = mainArticle.title;
    
    if (!mainText) {
        return {
            text: `<p>I found an entry for <strong>${title}</strong>, but the archives contain no readable text in the excerpt available to me.</p>`,
            meta: { confidence: 'low', sources: [title] }
        };
    }

    // Analyze what the question is asking for
    const questionFocus = analyzeQuestionFocus(query);
    
    // Extract all structured information from the article
    const facts = extractAllFacts(mainText, title);
    
    // Try to find information matching the question focus
    const relevantFacts = findRelevantFacts(facts, questionFocus, query);
    
    // Build a natural answer
    let response = buildNaturalAnswer(title, relevantFacts, questionFocus, query, mainText);
    
    // If we couldn't find specific info, try other articles
    let confidence = 'high';
    if (response.includes('not found') || response.includes('could not') || response.includes('unclear')) {
        for (let i = 1; i < Math.min(articles.length, 3); i++) {
            const altFacts = extractAllFacts(cleanText(articles[i].extract || ''), articles[i].title);
            const altRelevant = findRelevantFacts(altFacts, questionFocus, query);
            if (altRelevant.length > 0) {
                const altAnswer = buildNaturalAnswer(articles[i].title, altRelevant, questionFocus, query, cleanText(articles[i].extract || ''));
                if (!altAnswer.includes('not found')) {
                    response = `<p>While searching for information about ${title}, I found relevant details in the article on <strong>${articles[i].title}</strong>:</p>` + altAnswer;
                    confidence = 'medium';
                    break;
                }
            }
        }
    }
    
    // Final fallback: give an overview
    if (response.includes('not found') || response.includes('could not')) {
        response = generateOverview(title, mainText, facts);
        confidence = 'medium';
    }
    
    // Add synthesis from multiple sources if we have them
    if (articles.length > 1 && confidence !== 'low') {
        const synthesis = synthesizeAdditionalContext(articles.slice(1), questionFocus);
        if (synthesis) {
            response += synthesis;
        }
    }
    
    if (response.includes('not found') || response.includes('could not') || response.includes('unclear')) {
        confidence = 'low';
    }
    
    return {
        text: response,
        meta: { 
            confidence, 
            sources: articles.slice(0, 3).map(a => a.title) 
        }
    };
}

function analyzeQuestionFocus(query) {
    const lower = query.toLowerCase();
    const focus = {
        type: 'general',
        keywords: [],
        isComparison: false,
        isListRequest: false,
        isYesNo: false
    };
    
    // Detect question type from structure
    if (/^(who|whom)/i.test(query)) focus.type = 'person';
    if (/^(what)/i.test(query)) focus.type = 'definition';
    if (/^(when)/i.test(query)) focus.type = 'time';
    if (/^(where)/i.test(query)) focus.type = 'location';
    if (/^(why)/i.test(query)) focus.type = 'reason';
    if (/^(how)/i.test(query)) focus.type = 'method';
    if (/^(how many|how much)/i.test(query)) focus.type = 'quantity';
    if (/^(which)/i.test(query)) focus.type = 'selection';
    if (/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)/i.test(query)) {
        focus.type = 'confirmation';
        focus.isYesNo = true;
    }
    
    // Detect if asking for a list
    if (/\b(list|all|every|each|names of|types of|kinds of|examples of)\b/i.test(lower)) {
        focus.isListRequest = true;
    }
    
    // Detect comparison
    if (/\b(vs|versus|compare|difference|similar|better|worse|between|and)\b/i.test(lower)) {
        focus.isComparison = true;
    }
    
    // Extract key content words (not stop words)
    const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','can','could','may','might','must','shall','should','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','under','and','but','or','yet','so','if','because','since','although','though','while','where','when','who','what','which','whom','whose','how','why','this','that','these','those','i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves','he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their','theirs','themselves','what','which','who','whom','whose','this','that','these','those','am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing','a','an','the','and','but','if','or','because','as','until','while','of','at','by','for','with','through','during','before','after','above','below','up','down','in','out','on','off','over','under','again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','s','t','can','will','just','don','should','now','d','ll','m','o','re','ve','y','ain','aren','couldn','didn','doesn','hadn','hasn','haven','isn','ma','mightn','mustn','needn','shan','shouldn','wasn','weren','won','wouldn']);
    
    focus.keywords = lower.split(/\s+/)
        .map(w => w.replace(/[.,;:!?'"()[\]{}]/g, ''))
        .filter(w => w.length > 2 && !stopWords.has(w));
    
    return focus;
}

function extractAllFacts(text, title) {
    const facts = {
        title: title,
        dates: [],
        people: [],
        places: [],
        abilities: [],
        descriptions: [],
        relationships: [],
        events: [],
        measurements: [],
        titles_roles: [],
        physical_traits: [],
        affiliations: [],
        quotes: [],
        numbers: [],
        allSentences: []
    };
    
    const sentences = splitSentences(text);
    facts.allSentences = sentences;
    
    for (const sent of sentences) {
        const lower = sent.toLowerCase();
        
        // Dates and times
        const dateMatches = sent.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}(?:\s*AD|CE|BE)?|in\s+\d{4}|around\s+\d{4}|approximately\s+\d{4})\b/g);
        if (dateMatches) facts.dates.push(...dateMatches.map(d => ({ value: d, context: sent })));
        
        // Numbers and quantities
        const numMatches = sent.match(/\b(\d+(?:,\d{3})*(?:\.\d+)?\s*(?:years?|days?|hours?|miles?|feet|meters?|people|soldiers|men|women|children|books|spren|shards?))\b/gi);
        if (numMatches) facts.numbers.push(...numMatches.map(n => ({ value: n, context: sent })));
        
        // Physical descriptions
        if (/\b(tall|short|muscular|slender|thin|heavy|broad|lean|athletic|wiry|muscled|lanky|stocky|plump)\b/i.test(sent) ||
            /\b(hair|eyes|skin|face|beard|complexion|build|figure|features)\b/i.test(sent)) {
            facts.physical_traits.push(sent);
        }
        
        // Abilities and powers
        if (/\b(power|ability|magic|skill|talent|gift|blessing|curse)\b/i.test(sent) ||
            /\b(can|could|able|capable|wields|commands|controls|uses|burns|draws|channels)\b/i.test(sent)) {
            facts.abilities.push(sent);
        }
        
        // People and relationships
        if (/\b(father|mother|parent|brother|sister|sibling|son|daughter|child|wife|husband|spouse|family|cousin|uncle|aunt|friend|ally|enemy|master|student|mentor)\b/i.test(sent)) {
            facts.relationships.push(sent);
        }
        
        // Places and locations
        if (/\b(from|in|on|at|near|between|across|throughout|through|within)\b/i.test(sent) &&
            /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g.test(sent)) {
            const placeMatch = sent.match(/\b(from|in|on|at|near)\s+([A-Z][a-zA-Z\s]+?)(?:,|\.|;|$)/);
            if (placeMatch) facts.places.push({ value: placeMatch[2].trim(), context: sent });
        }
        
        // Titles and roles
        if (/\b(king|queen|emperor|lord|lady|prince|princess|highprince|knight|soldier|merchant|scholar|ardent|captain|general|commander|thief|spy|assassin|surgeon|writer|artist|engineer|leader|champion|herald|vessel|sliver)\b/i.test(sent)) {
            facts.titles_roles.push(sent);
        }
        
        // Events and actions
        if (/\b(fought|battled|led|commanded|discovered|created|founded|destroyed|saved|killed|defeated|betrayed|allied|joined|left|arrived|departed|returned)\b/i.test(sent)) {
            facts.events.push(sent);
        }
        
        // Affiliations
        if (/\b(member|part|belong|affiliate|serve|allied|loyal|follower|supporter|of\s+(?:the|house|order|crew|army|kingdom|empire))\b/i.test(sent)) {
            facts.affiliations.push(sent);
        }
        
        // General descriptions (substantive sentences about the subject)
        if (sent.length > 40 && sent.length < 300 &&
            (sent.includes(title) || sent.includes(title.split(' ')[0]))) {
            facts.descriptions.push(sent);
        }
    }
    
    // Extract capitalized phrases as potential people
    const peopleMatches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g);
    if (peopleMatches) {
        const commonWords = new Set(['The','A','An','In','On','At','To','For','Of','With','By','From','As','Into','Through','During','Before','After','Above','Below','Between','Under','And','But','Or','If','Then','Than','So','Because','Since','Although','Though','While','Where','When','Who','What','Which','Whom','Whose','How','Why','This','That','These','Those','I','Me','My','Myself','We','Our','Ours','Ourselves','You','Your','Yours','Yourself','Yourselves','He','Him','His','Himself','She','Her','Hers','Herself','It','Its','Itself','They','Them','Their','Theirs','Themselves','Am','Is','Are','Was','Were','Be','Been','Being','Have','Has','Had','Having','Do','Does','Did','Doing','Will','Would','Shall','Should','Can','Could','May','Might','Must','About','Also','Only','Just','Very','Really','Actually','Probably','Maybe','Perhaps','Still','Yet','Already','Almost','Quite','Rather','Pretty','Fairly','Somewhat','Here','There','Now','Then','Today','Tomorrow','Yesterday','Always','Never','Sometimes','Often','Usually','Again','Further','Once','Twice','First','Second','Third','Last','Next','Previous','Many','Much','More','Most','Some','Any','All','Each','Every','Few','Several','Various','Certain','Such','Other','Another','Same','Different','Own','Whole','Half','Part','Full','Empty','Small','Large','Big','Little','Tiny','Huge','Great','Good','Bad','New','Old','Young','Long','Short','High','Low','Deep','Wide','Narrow','Fast','Slow','Quick','Early','Late','Soon','Recent','Ancient','Modern','Future','Past','Present','True','False','Right','Wrong','Possible','Impossible','Necessary','Important','Special','General','Common','Rare','Normal','Strange','Beautiful','Ugly','Happy','Sad','Angry','Afraid','Brave','Weak','Strong','Rich','Poor','Free','Safe','Dangerous','Easy','Difficult','Hard','Soft','Smooth','Rough','Clean','Dirty','Hot','Cold','Warm','Cool','Dry','Wet','Bright','Dark','Light','Heavy','Light','Thick','Thin','Solid','Liquid','Gas','Alive','Dead','Sick','Healthy','Tired','Awake','Asleep','Hungry','Thirsty','Full','Empty','Open','Closed','Public','Private','Personal','Professional','Political','Social','Cultural','Historical','Scientific','Technical','Natural','Artificial','Human','Divine','Mortal','Immortal','Magical','Mundane','Ordinary','Extraordinary','Special','Unique','Typical','Regular','Standard','Official','Formal','Informal','Casual','Serious','Funny','Interesting','Boring','Exciting','Calm','Peaceful','Violent','Gentle','Cruel','Kind','Mean','Nice','Rude','Polite','Honest','Dishonest','Loyal','Faithful','True','False','Real','Fake','Actual','Virtual','Physical','Mental','Spiritual','Emotional','Intellectual','Creative','Destructive','Productive','Active','Passive','Positive','Negative','Neutral','Central','Local','Global','National','International','Universal','Cosmic','Worldly','Earthly','Heavenly','Hellish','Demonic','Angelic','Holy','Sacred','Profane','Pure','Corrupt','Innocent','Guilty','Simple','Complex','Complicated','Basic','Advanced','Elementary','Fundamental','Essential','Vital','Critical','Crucial','Key','Main','Major','Minor','Primary','Secondary','Tertiary','Initial','Final','Original','Copy','Version','Edition','Issue','Problem','Solution','Answer','Question','Result','Outcome','Effect','Cause','Reason','Purpose','Goal','Aim','Objective','Target','Plan','Strategy','Method','Way','Approach','Technique','Process','Procedure','System','Structure','Organization','Order','Chaos','Pattern','Design','Style','Form','Shape','Size','Color','Sound','Taste','Smell','Touch','Feel','Sense','Perception','Thought','Idea','Concept','Notion','Theory','Hypothesis','Fact','Truth','Reality','Illusion','Dream','Nightmare','Vision','Memory','Experience','Knowledge','Wisdom','Understanding','Insight','Awareness','Consciousness','Mind','Brain','Heart','Soul','Spirit','Body','Flesh','Blood','Bone','Life','Death','Birth','Creation','Destruction','Existence','Being','Entity','Object','Subject','Thing','Item','Tool','Weapon','Armor','Shield','Clothing','Food','Drink','Water','Fire','Air','Earth','Stone','Metal','Wood','Glass','Crystal','Gem','Jewel','Gold','Silver','Copper','Iron','Steel','Bronze','Tin','Lead','Mercury','Platinum','Diamond','Ruby','Sapphire','Emerald','Pearl','Amber','Jade','Ivory','Bone','Leather','Silk','Cotton','Wool','Paper','Ink','Paint','Color','Red','Blue','Green','Yellow','Orange','Purple','Pink','Brown','Black','White','Gray','Gold','Silver','Copper','Bronze','Brass']);
        
        const filtered = peopleMatches.filter(p => 
            p.length > 2 && 
            !commonWords.has(p) &&
            !/^\d+$/.test(p) &&
            p !== title
        );
        facts.people = [...new Set(filtered)].slice(0, 10);
    }
    
    return facts;
}

function findRelevantFacts(facts, focus, query) {
    const lowerQuery = query.toLowerCase();
    const relevant = [];
    
    // Score each fact type against the query keywords
    const scoreFact = (fact, type) => {
        const lower = (typeof fact === 'string' ? fact : fact.context || fact.value || '').toLowerCase();
        let score = 0;
        
        for (const kw of focus.keywords) {
            if (lower.includes(kw)) score += 10;
        }
        
        // Boost based on question type
        if (focus.type === 'time' && type === 'dates') score += 20;
        if (focus.type === 'person' && type === 'people') score += 15;
        if (focus.type === 'location' && type === 'places') score += 20;
        if (focus.type === 'definition' && type === 'descriptions') score += 15;
        if (focus.type === 'quantity' && type === 'numbers') score += 20;
        if (focus.type === 'confirmation' && (type === 'descriptions' || type === 'events')) score += 10;
        
        // Boost sentences that contain the subject's name
        if (lower.includes(facts.title.toLowerCase())) score += 5;
        
        return score;
    };
    
    // Collect all facts with scores
    const allScored = [];
    
    for (const [type, factList] of Object.entries(facts)) {
        if (type === 'allSentences' || type === 'title') continue;
        for (const fact of factList) {
            const text = typeof fact === 'string' ? fact : (fact.context || fact.value || '');
            const score = scoreFact(fact, type);
            if (score > 0) {
                allScored.push({ text, type, score, raw: fact });
            }
        }
    }
    
    // Also score general descriptions
    for (const sent of facts.descriptions) {
        const score = scoreFact(sent, 'descriptions');
        if (score > 0) {
            allScored.push({ text: sent, type: 'descriptions', score, raw: sent });
        }
    }
    
    // Sort by relevance
    allScored.sort((a, b) => b.score - a.score);
    
    // Remove duplicates and return top facts
    const seen = new Set();
    for (const item of allScored) {
        const key = item.text.substring(0, 60);
        if (!seen.has(key)) {
            seen.add(key);
            relevant.push(item);
        }
    }
    
    return relevant.slice(0, 8);
}

function buildNaturalAnswer(title, relevantFacts, focus, query, fullText) {
    if (relevantFacts.length === 0) {
        // Try to give a helpful fallback
        const sentences = splitSentences(fullText);
        const substantive = sentences.filter(s => s.length > 50 && s.length < 250).slice(0, 3);
        
        if (substantive.length > 0) {
            let response = `<p>I could not find a specific answer to your exact question, but here is what I know about <strong>${title}</strong>:</p>`;
            for (const sent of substantive) {
                response += `<p>${sent}.</p>`;
            }
            return response;
        }
        
        return `<p>I searched the archives for <strong>${title}</strong> but could not find information directly addressing your question. The available excerpts do not contain the specific details you seek. You may wish to consult the full article on the Coppermind.</p>`;
    }
    
    // Group facts by type for coherent answering
    const byType = {};
    for (const fact of relevantFacts) {
        if (!byType[fact.type]) byType[fact.type] = [];
        byType[fact.type].push(fact);
    }
    
    let response = '';
    
    // Handle different question structures
    if (focus.isYesNo) {
        // Yes/No questions
        const topFact = relevantFacts[0];
        const answer = inferYesNo(topFact.text, query);
        response = `<p>${answer}</p>`;
        if (relevantFacts.length > 1) {
            response += `<p>${relevantFacts[1].text}.</p>`;
        }
    } else if (focus.isListRequest) {
        // List requests
        response = `<p>Here is what I found regarding <strong>${title}</strong>:</p><ul>`;
        const uniqueItems = [...new Set(relevantFacts.map(f => f.text).filter(t => t.length > 20))].slice(0, 6);
        for (const item of uniqueItems) {
            response += `<li>${item}</li>`;
        }
        response += `</ul>`;
    } else if (focus.type === 'time') {
        // Time/date questions
        const dateFacts = byType['dates'] || relevantFacts;
        if (dateFacts.length > 0) {
            const date = dateFacts[0].raw.value || dateFacts[0].text;
            response = `<p><strong>${title}</strong> — <strong>${date}</strong>.</p>`;
            if (dateFacts[0].raw.context) {
                response += `<p>${dateFacts[0].raw.context}</p>`;
            }
        } else {
            response = `<p>I could not find a specific date or time related to your question about <strong>${title}</strong> in the available archives.</p>`;
        }
    } else if (focus.type === 'location') {
        // Location questions
        const placeFacts = byType['places'] || relevantFacts;
        if (placeFacts.length > 0) {
            const place = placeFacts[0].raw.value || extractLocation(placeFacts[0].text);
            response = `<p><strong>${title}</strong> is associated with <strong>${place}</strong>.</p>`;
            for (let i = 1; i < Math.min(placeFacts.length, 3); i++) {
                response += `<p>${placeFacts[i].text}.</p>`;
            }
        }
    } else if (focus.type === 'quantity') {
        // Number questions
        const numFacts = byType['numbers'] || relevantFacts;
        if (numFacts.length > 0) {
            const num = numFacts[0].raw.value || extractNumber(numFacts[0].text);
            response = `<p><strong>${title}</strong> — <strong>${num}</strong>.</p>`;
            if (numFacts.length > 1) {
                response += `<p>Additionally: ${numFacts[1].text}.</p>`;
            }
        }
    } else {
        // General answer — build a coherent paragraph
        const topFacts = relevantFacts.slice(0, 4);
        
        // Start with the most relevant fact
        if (topFacts[0].type === 'descriptions' || topFacts[0].type === 'physical_traits') {
            response = `<p><strong>${title}</strong> is ${topFacts[0].text.toLowerCase()}.</p>`;
        } else {
            response = `<p>Regarding <strong>${title}</strong>: ${topFacts[0].text}.</p>`;
        }
        
        // Add supporting facts
        for (let i = 1; i < topFacts.length; i++) {
            const fact = topFacts[i];
            let connector = '';
            if (i === 1) connector = 'Furthermore, ';
            else if (i === 2) connector = 'In addition, ';
            else connector = 'Also, ';
            
            // Avoid repeating the same info
            if (!response.includes(fact.text.substring(0, 40))) {
                response += `<p>${connector}${fact.text}.</p>`;
            }
        }
    }
    
    // Add a concluding synthesis if we have multiple fact types
    const types = Object.keys(byType);
    if (types.length > 2 && !focus.isYesNo && !focus.isListRequest) {
        const synthesis = generateSynthesis(title, byType, focus);
        if (synthesis && !response.includes(synthesis.substring(0, 50))) {
            response += `<p><em>${synthesis}</em></p>`;
        }
    }
    
    return response;
}

function inferYesNo(factText, query) {
    const lowerFact = factText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Check for negation
    const negations = ['not', 'never', 'no', 'without', 'neither', 'nor', 'none', 'nothing', 'nobody', 'nowhere', 'hardly', 'scarcely', 'barely', "doesn't", "isn't", "wasn't", "shouldn't", "wouldn't", "couldn't", "can't", "won't", "don't", "didn't", "hasn't", "haven't", "hadn't"];
    const hasNegation = negations.some(n => lowerFact.includes(n));
    
    // Check if the fact supports the query
    const queryWords = lowerQuery.replace(/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\s+/i, '')
        .replace(/\?/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
    
    const matches = queryWords.filter(w => lowerFact.includes(w)).length;
    const matchRatio = queryWords.length > 0 ? matches / queryWords.length : 0;
    
    if (matchRatio > 0.3 && !hasNegation) {
        return `Yes — ${factText}.`;
    } else if (matchRatio > 0.3 && hasNegation) {
        return `No — ${factText}.`;
    } else if (hasNegation) {
        return `Based on the archives, this appears to be incorrect — ${factText}.`;
    } else {
        return `The archives indicate: ${factText}.`;
    }
}

function generateSynthesis(title, byType, focus) {
    const parts = [];
    
    if (byType['dates'] && byType['dates'].length > 0) {
        const d = byType['dates'][0].raw.value || byType['dates'][0].text;
        parts.push(`temporally situated around ${d}`);
    }
    
    if (byType['places'] && byType['places'].length > 0) {
        const p = byType['places'][0].raw.value || extractLocation(byType['places'][0].text);
        parts.push(`connected to ${p}`);
    }
    
    if (byType['abilities'] && byType['abilities'].length > 0) {
        parts.push(`possessing notable abilities`);
    }
    
    if (byType['relationships'] && byType['relationships'].length > 0) {
        parts.push(`with significant relationships`);
    }
    
    if (parts.length < 2) return null;
    
    return `Taken together, ${title} emerges from the archives as a figure ${parts.join(', ')}, woven into the larger tapestry of the Cosmere.`;
}

function generateOverview(title, text, facts) {
    const sentences = splitSentences(text);
    const intro = sentences.filter(s => s.length > 40 && s.length < 250).slice(0, 3);
    
    let response = `<p><strong>${title}</strong> is ${intro[0] || 'a figure in the Cosmere'}.</p>`;
    
    if (intro.length > 1) {
        for (let i = 1; i < intro.length; i++) {
            response += `<p>${intro[i]}.</p>`;
        }
    }
    
    // Add quick facts if available
    const quickFacts = [];
    if (facts.dates.length > 0) quickFacts.push(`Born/dates: ${facts.dates[0].value}`);
    if (facts.places.length > 0) quickFacts.push(`From: ${facts.places[0].value}`);
    if (facts.abilities.length > 0) quickFacts.push(`Notable for abilities`);
    if (facts.titles_roles.length > 0) quickFacts.push(`Holds significant titles`);
    
    if (quickFacts.length > 0) {
        response += `<p><strong>Quick facts:</strong> ${quickFacts.join(' • ')}</p>`;
    }
    
    return response;
}

function synthesizeAdditionalContext(articles, focus) {
    if (articles.length === 0) return null;
    
    const snippets = [];
    for (const art of articles.slice(0, 2)) {
        const text = cleanText(art.extract || '');
        const sentences = splitSentences(text).filter(s => s.length > 50 && s.length < 200);
        if (sentences.length > 0) {
            snippets.push({ text: sentences[0], source: art.title });
        }
    }
    
    if (snippets.length === 0) return null;
    
    let result = `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;">`;
    result += `Additional context from the archives: `;
    result += snippets.map(s => `the article on <strong>${s.source}</strong> notes that ${s.text.toLowerCase()}`).join('; ');
    result += `.</p>`;
    
    return result;
}

function extractLocation(text) {
    const match = text.match(/\b(from|in|on|at|near)\s+([A-Z][a-zA-Z\s]+?)(?:,|\.|;|$)/);
    return match ? match[2].trim() : 'an unknown location';
}

function extractNumber(text) {
    const match = text.match(/\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*\w*/);
    return match ? match[0] : 'an unspecified amount';
}

// ==================== UTILITIES ====================

function cleanText(text) {
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

function splitSentences(text) {
    // Smart sentence splitting that handles common abbreviations
    return text
        .replace(/([.!?])\s+/g, "$1|")
        .split("|")
        .map(s => s.trim())
        .filter(s => s.length > 10);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
