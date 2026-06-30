const API_BASE = 'https://coppermind.net/w/api.php';
const WIKI_BASE = 'https://coppermind.net/wiki/';

// ==================== STATE ====================
const State = {
    cache: new Map(),
    context: { lastEntity: null, lastTopic: null, history: [] },
    
    get(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.time < 1000 * 60 * 60) return item.data;
        return null;
    },
    
    set(key, data) {
        this.cache.set(key, { data, time: Date.now() });
        if (this.cache.size > 500) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
    }
};

// ==================== UI ====================
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const typingIndicator = document.getElementById('typingIndicator');

chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function askSuggestion(text) { chatInput.value = text; sendMessage(); }

function startNewChat() {
    State.context = { lastEntity: null, lastTopic: null, history: [] };
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
                <p>Greetings, traveler. I am the Coppermind Scholar. Ask me anything about Brandon Sanderson's Cosmere.</p>
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
        const answer = await Scholar.process(text);
        hideTyping();
        addMessage(answer.text, 'bot', answer.meta);
    } catch (err) {
        console.error(err);
        hideTyping();
        addMessage("The perpendicularity is unstable — I cannot reach the Coppermind archives. Please try again.", 'bot');
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
    if (meta?.sources?.length) {
        const links = meta.sources.map(s => 
            `<a class="citation" href="${WIKI_BASE}${encodeURIComponent(s.replace(/ /g, '_'))}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`
        ).join(' • ');
        metaHtml += `<div style="margin-top:10px; font-size: 0.8rem;">Sources: ${links}</div>`;
    }
    if (meta?.confidence) {
        const color = meta.confidence === 'high' ? '#4ade80' : meta.confidence === 'medium' ? '#fbbf24' : '#f87171';
        metaHtml += `<span class="confidence" style="color: ${color};">Confidence: ${meta.confidence}</span>`;
    }
    
    div.innerHTML = `
        <div class="avatar">${sender === 'bot' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' : ''}</div>
        <div class="message-content"><div class="message-text">${text}</div>${metaHtml}<span class="timestamp">${time}</span></div>
    `;
    chatMessages.appendChild(div);
    scrollToBottom();
    State.context.history.push({ sender, text });
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }
function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ==================== COPPERMIND API ====================
const API = {
    async search(query, limit = 15) {
        const cacheKey = `search:${query}`;
        const cached = State.get(cacheKey);
        if (cached) return cached;
        
        try {
            const params = new URLSearchParams({
                action: 'query', list: 'search', srsearch: query,
                srlimit: limit, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const results = data.query?.search || [];
            State.set(cacheKey, results);
            return results;
        } catch (e) { return []; }
    },
    
    async openSearch(query, limit = 10) {
        try {
            const params = new URLSearchParams({
                action: 'opensearch', search: query, limit, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            return (data[1] || []).map((title, i) => ({ title, index: i }));
        } catch (e) { return []; }
    },
    
    async getPage(title) {
        const cacheKey = `page:${title}`;
        const cached = State.get(cacheKey);
        if (cached) return cached;
        
        try {
            // Fetch raw wikitext
            const wtParams = new URLSearchParams({
                action: 'query', prop: 'revisions', titles: title,
                rvprop: 'content', rvslots: 'main', format: 'json', origin: '*'
            });
            const wtRes = await fetch(`${API_BASE}?${wtParams}`);
            const wtData = await wtRes.json();
            const pages = wtData.query?.pages || {};
            const page = Object.values(pages)[0];
            const wikitext = page?.revisions?.[0]?.slots?.main?.['*'] || page?.revisions?.[0]?.['*'] || '';
            
            // Fetch categories
            const catParams = new URLSearchParams({
                action: 'query', prop: 'categories', titles: title,
                cllimit: 50, format: 'json', origin: '*'
            });
            const catRes = await fetch(`${API_BASE}?${catParams}`);
            const catData = await catRes.json();
            const catPages = catData.query?.pages || {};
            const catPage = Object.values(catPages)[0];
            const categories = (catPage?.categories || []).map(c => c.title.replace('Category:', ''));
            
            // Fetch extract
            const extParams = new URLSearchParams({
                action: 'query', prop: 'extracts', titles: title,
                exchars: 10000, explaintext: true, exlimit: 1,
                format: 'json', origin: '*'
            });
            const extRes = await fetch(`${API_BASE}?${extParams}`);
            const extData = await extRes.json();
            const extPages = extData.query?.pages || {};
            const extPage = Object.values(extPages)[0];
            const extract = extPage?.extract || '';
            
            const result = { title, wikitext, categories, extract };
            State.set(cacheKey, result);
            return result;
        } catch (e) { return null; }
    }
};

// ==================== WIKITEXT PARSER ====================
const Parser = {
    parse(page) {
        const wikitext = page.wikitext || '';
        const extract = page.extract || '';
        
        return {
            title: page.title,
            categories: page.categories || [],
            infobox: this.parseInfobox(wikitext),
            introduction: this.cleanText(extract.substring(0, 3000)),
            fullText: this.cleanText(extract),
            rawWikitext: wikitext
        };
    },
    
    parseInfobox(text) {
        const infobox = {};
        if (!text) return infobox;
        
        // Find template with balanced braces
        let start = -1, depth = 0;
        for (let i = 0; i < text.length - 1; i++) {
            if (text[i] === '{' && text[i+1] === '{') {
                if (depth === 0) start = i;
                depth++;
                i++;
            } else if (text[i] === '}' && text[i+1] === '}') {
                depth--;
                i++;
                if (depth === 0 && start !== -1) {
                    const template = text.substring(start + 2, i - 1);
                    if (/^(?:Character|Location|Magic|Book|Event|Group|Creature|Shard|Spren)/i.test(template)) {
                        this.parseTemplateFields(template, infobox);
                    }
                    start = -1;
                }
            }
        }
        
        return infobox;
    },
    
    parseTemplateFields(templateContent, infobox) {
        let content = templateContent;
        const firstPipe = content.indexOf('|');
        if (firstPipe > 0) content = content.substring(firstPipe + 1);
        
        const fields = this.splitByPipe(content);
        
        for (const field of fields) {
            const eq = field.indexOf('=');
            if (eq > 0) {
                let key = field.substring(0, eq).trim().toLowerCase();
                let value = field.substring(eq + 1).trim();
                value = this.cleanValue(value);
                
                if (key && value && value.length > 0 && value.length < 500 && !value.match(/^\W*$/)) {
                    const values = value.split(/,|<br\s*\/?>/).map(v => v.trim()).filter(v => v.length > 0 && !v.match(/^\W*$/));
                    infobox[key] = values.length === 1 ? values[0] : values;
                }
            }
        }
    },
    
    splitByPipe(content) {
        const fields = [];
        let current = '', depth = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (char === '{' || char === '[') {
                depth++;
                current += char;
            } else if (char === '}' || char === ']') {
                depth--;
                current += char;
            } else if (char === '|' && depth === 0) {
                if (current.trim()) fields.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) fields.push(current.trim());
        return fields;
    },
    
    cleanValue(value) {
        if (!value) return '';
        
        value = value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
        value = value.replace(/\[\[([^\]]+)\]\]/g, '$1');
        value = value.replace(/\{\{[^{}]*\}\}/g, '');
        value = value.replace(/<[^>]+>/g, ' ');
        value = value.replace(/<ref[^>]*>.*?<\/ref>/gi, '');
        value = value.replace(/<ref[^>]*\/>/gi, '');
        value = value.replace(/'''?(.*?)'''?/g, '$1');
        value = value.replace(/''(.*?)''/g, '$1');
        value = value.replace(/\s+/g, ' ').trim();
        value = value.replace(/^[,;\s]+|[,;\s]+$/g, '');
        value = value.replace(/\(\s*\)/g, '');
        
        return value;
    },
    
    cleanText(text) {
        if (!text) return '';
        return text
            .replace(/\{\{[^{}]*\}\}/g, '')
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
            .replace(/\[\[([^\]]+)\]\]/g, '$1')
            .replace(/'''?(.*?)'''?/g, '$1')
            .replace(/''(.*?)''/g, '$1')
            .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
            .replace(/<ref[^>]*\/>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/==+.*?==+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
};

// ==================== QUESTION ANALYZER ====================
const Analyzer = {
    analyze(query) {
        const lower = query.toLowerCase().replace(/[?.,!]/g, '');
        
        const isFollowUp = State.context.lastEntity && 
            /^(what about|and |what |how about|tell me more|who else|where else|why |how |when |is |are |was |were |did |does |do |can |could |would |should |will |has |have |had )/i.test(query) &&
            query.length < 50;
        
        let processedQuery = query;
        if (isFollowUp && !query.toLowerCase().includes(State.context.lastEntity.toLowerCase())) {
            processedQuery = query + ' ' + State.context.lastEntity;
        }
        
        const entity = this.extractEntity(processedQuery);
        const intent = this.classifyIntent(lower, query);
        
        return { query, processedQuery, entity, intent, original: query, isFollowUp };
    },
    
    extractEntity(query) {
        const qWords = ['who is','who was','what is','what are','what was','when is','when was','when were','when did','where is','where was','where did','why is','why was','how is','how was','how did','how many','how much','tell me about','describe','explain','define','what about','how about','is ','are ','was ','were ','did ','does ','do ','can ','could ','would ','should ','will ','has ','have ','had '];
        
        let cleaned = query;
        const lower = query.toLowerCase();
        for (const qw of qWords) {
            if (lower.startsWith(qw)) {
                cleaned = query.substring(qw.length).trim();
                break;
            }
        }
        
        cleaned = cleaned.replace(/[?.,!]$/, '').trim();
        
        // Extract proper nouns
        const words = cleaned.split(/\s+/);
        let best = '';
        let current = [];
        
        for (const w of words) {
            if (/^[A-Z][a-zA-Z]+$/.test(w) && w.length > 1) {
                current.push(w);
            } else if (w.length > 0) {
                const phrase = current.join(' ');
                if (phrase.length > best.length) best = phrase;
                current = [];
            }
        }
        const last = current.join(' ');
        if (last.length > best.length) best = last;
        
        if (!best) best = cleaned.split(/\s+(?:and|or|but)\s+/i).sort((a, b) => b.length - a.length)[0] || cleaned;
        
        return best || query.replace(/[?.,!]$/, '').trim();
    },
    
    classifyIntent(lower, original) {
        if (/\b(born|birth|when .* born)\b/.test(lower)) return 'birth';
        if (/\b(died|death|dead|killed|when .* die)\b/.test(lower)) return 'death';
        if (/\b(how old|age|years old)\b/.test(lower)) return 'age';
        if (/\b(look like|appearance|hair|eyes|skin|tall|short|build|handsome|beautiful)\b/.test(lower)) return 'appearance';
        if (/\b(family|parents|father|mother|brother|sister|wife|husband|married|son|daughter)\b/.test(lower)) return 'family';
        if (/\b(powers|abilities|magic|allomancy|surgebinding|feruchemy|hemalurgy|awakening|investiture|shardblade|spren|radiant|mistborn)\b/.test(lower)) return 'abilities';
        if (/\b(job|work|occupation|profession|role|soldier|knight|captain|lord|king|emperor|thief|spy|assassin)\b/.test(lower)) return 'role';
        if (/\b(from|planet|world|where .* from|homeworld|realm|location|city|nation)\b/.test(lower)) return 'origin';
        if (/\b(book|appear|featured|introduced|series|stormlight|mistborn|elantris|warbreaker)\b/.test(lower)) return 'appearances';
        if (/\b(personality|character|brave|honest|kind|cruel|smart|wise|depressed|honorable|loyal|stubborn)\b/.test(lower)) return 'personality';
        if (/\b(what did|what happened|fight|battle|war|defeat|save|destroy|create|lead|betray|rescue)\b/.test(lower)) return 'events';
        if (/^(what is|what are|explain|define|describe|how does|tell me about)/i.test(original)) return 'concept';
        if (/\b(vs|versus|compare|difference|similar|better|worse|stronger)\b/.test(lower)) return 'comparison';
        if (/\b(list|all|every|names|types|kinds|orders)\b/.test(lower)) return 'list';
        if (/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\b/i.test(original)) return 'yesno';
        return 'overview';
    }
};

// ==================== SEARCH & RANKING ====================
const SearchEngine = {
    async findArticles(analysis) {
        const { entity, query } = analysis;
        const results = [];
        
        // Strategy 1: Try exact title match first (CRITICAL FIX)
        const exactMatch = await this.tryExactTitle(entity);
        if (exactMatch) {
            results.push(exactMatch);
        }
        
        // Strategy 2: Search API
        const searchResults = await API.search(query, 15);
        for (const r of searchResults) {
            if (!results.find(x => x.title === r.title)) {
                results.push({ title: r.title, snippet: r.snippet, score: this.scoreResult(r, entity) });
            }
        }
        
        // Strategy 3: OpenSearch
        const openResults = await API.openSearch(entity, 10);
        for (const r of openResults) {
            if (!results.find(x => x.title === r.title)) {
                results.push({ title: r.title, score: this.scoreResult({ title: r.title }, entity) - 5 });
            }
        }
        
        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        
        // DEBUG
        console.log('Search results:', results.map(r => ({ title: r.title, score: r.score })));
        
        return results;
    },
    
    async tryExactTitle(entity) {
        // Try the entity as an exact page title
        const page = await API.getPage(entity);
        if (page && page.wikitext && page.wikitext.length > 100) {
            return { title: page.title, score: 1000, exact: true };
        }
        
        // Try common variations
        const variations = [
            entity,
            entity + ' (character)',
            entity + ' (Cosmere)',
            entity + ' (Mistborn)',
            entity + ' (Stormlight Archive)'
        ];
        
        for (const v of variations) {
            const p = await API.getPage(v);
            if (p && p.wikitext && p.wikitext.length > 100) {
                return { title: p.title, score: 950, exact: true };
            }
        }
        
        return null;
    },
    
    scoreResult(result, entity) {
        let score = 0;
        const title = result.title || '';
        const titleLower = title.toLowerCase();
        const entityLower = entity.toLowerCase();
        
        // Exact match = highest score
        if (titleLower === entityLower) score += 500;
        else if (titleLower === entityLower + ' (character)') score += 450;
        else if (titleLower === entityLower + ' (cosmere)') score += 400;
        
        // Starts with entity
        else if (titleLower.startsWith(entityLower + ' ')) score += 300;
        else if (titleLower.startsWith(entityLower)) score += 250;
        
        // Contains entity as whole word
        else if (new RegExp(`\\b${entityLower}\\b`).test(titleLower)) score += 200;
        
        // Contains entity as substring
        else if (titleLower.includes(entityLower)) score += 100;
        
        // Character category bonus
        const snippet = (result.snippet || '').toLowerCase();
        if (snippet.includes('character') || snippet.includes('is a') || snippet.includes('was a')) score += 50;
        
        // Penalize unrelated matches (like "Vindication" for "Vin")
        if (titleLower.length > entityLower.length + 3 && !titleLower.includes(entityLower)) {
            score -= 100;
        }
        
        return score;
    }
};

// ==================== KNOWLEDGE EXTRACTION ====================
const Extractor = {
    extract(page) {
        const k = {
            name: page.title,
            type: this.detectType(page),
            infobox: page.infobox || {},
            attributes: {},
            abilities: [],
            titles: [],
            relationships: [],
            places: [],
            books: [],
            physical: [],
            events: [],
            description: page.introduction || '',
            fullText: page.fullText || ''
        };
        
        // Extract from infobox
        const ib = page.infobox;
        
        if (ib.born || ib.birth) k.attributes.birth = ib.born || ib.birth;
        if (ib.died || ib.death) k.attributes.death = ib.died || ib.death;
        if (ib.age) k.attributes.age = ib.age;
        if (ib.world || ib.planet || ib.universe) k.places.push(ib.world || ib.planet || ib.universe);
        if (ib.abilities || ib.powers || ib.skills || ib.magic) {
            const abs = ib.abilities || ib.powers || ib.skills || ib.magic;
            k.abilities.push(...(Array.isArray(abs) ? abs : [abs]));
        }
        if (ib.titles || ib.occupation || ib.profession || ib.role) {
            const t = ib.titles || ib.occupation || ib.profession || ib.role;
            k.titles.push(...(Array.isArray(t) ? t : [t]));
        }
        if (ib.family || ib.parents || ib.spouse || ib.children || ib.relatives) {
            const rels = ib.family || ib.parents || ib.spouse || ib.children || ib.relatives;
            k.relationships.push(...(Array.isArray(rels) ? rels : [rels]));
        }
        if (ib.groups || ib.affiliation || ib.allegiance || ib.crew || ib.house) {
            const g = ib.groups || ib.affiliation || ib.allegiance || ib.crew || ib.house;
            k.attributes.groups = Array.isArray(g) ? g : [g];
        }
        if (ib.books || ib.appearances || ib.introduced) {
            const b = ib.books || ib.appearances || ib.introduced;
            k.books.push(...(Array.isArray(b) ? b : [b]));
        }
        if (ib.hair || ib.eyes || ib.height || ib.skin || ib.appearance) {
            if (ib.hair) k.physical.push(`Hair: ${ib.hair}`);
            if (ib.eyes) k.physical.push(`Eyes: ${ib.eyes}`);
            if (ib.height) k.physical.push(`Height: ${ib.height}`);
            if (ib.skin) k.physical.push(`Skin: ${ib.skin}`);
        }
        
        // Extract from text
        const text = page.fullText || '';
        const sentences = this.splitSentences(text);
        
        for (const sent of sentences.slice(0, 20)) {
            const lower = sent.toLowerCase();
            
            // Physical traits
            if ((lower.includes('hair') || lower.includes('eyes') || lower.includes('skin') || 
                 lower.includes('tall') || lower.includes('build') || lower.includes('appearance')) &&
                sent.length > 20 && sent.length < 200) {
                if (!k.physical.includes(sent)) k.physical.push(sent);
            }
            
            // Abilities
            if (/\b(power|ability|magic|skill|wields|commands|controls|uses|burns|surgebind|allomanc|feruchem|awaken|hemalurg)\b/i.test(sent) &&
                sent.length > 20 && sent.length < 200) {
                if (!k.abilities.includes(sent)) k.abilities.push(sent);
            }
            
            // Events
            if (/\b(fought|battled|led|commanded|discovered|created|destroyed|saved|killed|defeated|betrayed|allied|joined|returned|escaped|rescued|survived|overthrew)\b/i.test(sent) &&
                sent.length > 20 && sent.length < 200) {
                if (!k.events.includes(sent)) k.events.push(sent);
            }
            
            // Books
            const bookNames = ['The Way of Kings','Words of Radiance','Oathbringer','Rhythm of War','Wind and Truth','Mistborn','The Final Empire','The Well of Ascension','The Hero of Ages','The Alloy of Law','Shadows of Self','The Bands of Mourning','The Lost Metal','Elantris','Warbreaker','Arcanum Unbounded','White Sand','Tress of the Emerald Sea','Yumi and the Nightmare Painter','The Sunlit Man','Dawnshard','Edgedancer'];
            for (const book of bookNames) {
                if (sent.includes(book) && !k.books.includes(book)) k.books.push(book);
            }
        }
        
        return k;
    },
    
    detectType(page) {
        const cats = page.categories || [];
        const text = (page.introduction || '').toLowerCase();
        
        if (cats.some(c => /character|people|persons/.test(c))) return 'character';
        if (cats.some(c => /magic|metallic|investiture|surge/.test(c))) return 'magic';
        if (cats.some(c => /location|place|city|nation|world/.test(c))) return 'location';
        if (cats.some(c => /book|novel|series/.test(c))) return 'book';
        if (cats.some(c => /spren|creature/.test(c))) return 'creature';
        if (cats.some(c => /shard|vessel/.test(c))) return 'shard';
        if (text.includes('is a character')) return 'character';
        if (text.includes('is a magic')) return 'magic';
        if (text.includes('is a planet') || text.includes('is a world')) return 'location';
        
        return 'unknown';
    },
    
    splitSentences(text) {
        return text
            .replace(/([.!?])\s+/g, "$1|")
            .split("|")
            .map(s => s.trim())
            .filter(s => s.length > 15 && s.length < 400);
    }
};

// ==================== ANSWER ENGINE ====================
const AnswerEngine = {
    generate(analysis, knowledge) {
        const { intent } = analysis;
        const k = knowledge;
        
        const handlers = {
            birth: () => this.birth(k),
            death: () => this.death(k),
            age: () => this.age(k),
            appearance: () => this.appearance(k),
            family: () => this.family(k),
            abilities: () => this.abilities(k),
            role: () => this.role(k),
            origin: () => this.origin(k),
            appearances: () => this.appearances(k),
            personality: () => this.personality(k),
            events: () => this.events(k),
            concept: () => this.concept(k),
            comparison: () => this.comparison(k),
            list: () => this.list(k),
            yesno: () => this.yesno(k, analysis),
            overview: () => this.overview(k)
        };
        
        let response = (handlers[intent] || handlers.overview)();
        let confidence = 'high';
        
        // Fallback
        if (response.includes('could not find') || response.includes('not specified')) {
            if (intent !== 'overview') {
                const fallback = this.overview(k);
                if (!fallback.includes('could not find')) {
                    response = `<p>I could not find a direct answer, but here is what I know about <strong>${k.name}</strong>:</p>` + fallback;
                    confidence = 'medium';
                }
            }
        }
        
        if (response.includes('could not find') || response.includes('not specified')) {
            confidence = 'low';
        }
        
        return { text: response, meta: { confidence, sources: [k.name] } };
    },
    
    birth(k) {
        if (k.attributes.birth) {
            return `<p><strong>${k.name}</strong> was born in <strong>${k.attributes.birth}</strong>.</p>`;
        }
        return `<p>I could not find a birth date for <strong>${k.name}</strong>.</p>`;
    },
    
    death(k) {
        if (k.attributes.death) {
            return `<p><strong>${k.name}</strong> died in <strong>${k.attributes.death}</strong>.</p>`;
        }
        if (/\b(still alive|currently|survived)\b/i.test(k.fullText)) {
            return `<p><strong>${k.name}</strong> is still alive.</p>`;
        }
        return `<p>I could not find a death date for <strong>${k.name}</strong>.</p>`;
    },
    
    age(k) {
        if (k.attributes.age) {
            return `<p><strong>${k.name}</strong> is <strong>${k.attributes.age}</strong> old.</p>`;
        }
        const match = k.fullText.match(/(?:is|was|age[d\s]+)\s+(\d+)\s+years?\s+old/i);
        if (match) {
            return `<p><strong>${k.name}</strong> is <strong>${match[1]} years old</strong>.</p>`;
        }
        const birthMatch = k.fullText.match(/born\s+(?:in\s+)?(\d{4})/i);
        if (birthMatch) {
            const year = parseInt(birthMatch[1]);
            const present = k.places.some(p => /scadrial|mistborn|elendel/i.test(p)) ? 348 : 
                           k.places.some(p => /nalthis|warbreaker|hallandren/i.test(p)) ? 328 :
                           k.places.some(p => /sel|elantris/i.test(p)) ? 928 : 1175;
            return `<p><strong>${k.name}</strong> was born in <strong>${year}</strong>, making them approximately <strong>${present - year} years old</strong>.</p>`;
        }
        return `<p>I could not determine the age of <strong>${k.name}</strong>.</p>`;
    },
    
    appearance(k) {
        const traits = k.physical.filter(t => t.length > 10 && !t.match(/^\W*$/)).slice(0, 5);
        if (traits.length > 0) {
            return `<p><strong>${k.name}</strong> is described as follows:</p><ul>${traits.map(t => `<li>${t}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find a physical description of <strong>${k.name}</strong>.</p>`;
    },
    
    family(k) {
        const rels = k.relationships.filter(r => r.length > 2 && !r.match(/^\W*$/)).slice(0, 6);
        if (rels.length > 0) {
            return `<p><strong>${k.name}'s</strong> family and relationships:</p><ul>${rels.map(r => `<li>${r}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find family information for <strong>${k.name}</strong>.</p>`;
    },
    
    abilities(k) {
        const abs = k.abilities.filter(a => a.length > 2 && !a.match(/^\W*$/)).slice(0, 8);
        if (abs.length > 0) {
            return `<p><strong>${k.name}</strong> possesses the following abilities:</p><ul>${abs.map(a => `<li>${a}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find specific abilities for <strong>${k.name}</strong>.</p>`;
    },
    
    role(k) {
        const titles = k.titles.filter(t => t.length > 2 && !t.match(/^\W*$/)).slice(0, 5);
        if (titles.length > 0) {
            return `<p><strong>${k.name}</strong> is ${titles.join(', ')}.</p>`;
        }
        return `<p>I could not determine the role of <strong>${k.name}</strong>.</p>`;
    },
    
    origin(k) {
        const places = k.places.filter(p => p.length > 1 && !p.match(/^\W*$/));
        if (places.length > 0) {
            return `<p><strong>${k.name}</strong> is from <strong>${places[0]}</strong>.</p>`;
        }
        return `<p>I could not determine the origin of <strong>${k.name}</strong>.</p>`;
    },
    
    appearances(k) {
        const books = k.books.filter(b => b.length > 2 && !b.match(/^\W*$/)).slice(0, 10);
        if (books.length > 0) {
            return `<p><strong>${k.name}</strong> appears in:</p><ul>${books.map(b => `<li>${b}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find book appearances for <strong>${k.name}</strong>.</p>`;
    },
    
    personality(k) {
        const sentences = Extractor.splitSentences(k.fullText).slice(0, 12);
        const traits = [];
        for (const sent of sentences) {
            const lower = sent.toLowerCase();
            if ((lower.includes('personality') || lower.includes('honor') || lower.includes('determined') ||
                 lower.includes('broken') || lower.includes('struggles') || lower.includes('depression') ||
                 lower.includes('brave') || lower.includes('stubborn') || lower.includes('loyal') ||
                 lower.includes('kind') || lower.includes('cruel')) && sent.length > 30 && sent.length < 250) {
                traits.push(sent);
            }
        }
        if (traits.length > 0) {
            return `<p><strong>${k.name}'s</strong> personality:</p><ul>${traits.slice(0, 5).map(t => `<li>${t}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find personality information for <strong>${k.name}</strong>.</p>`;
    },
    
    events(k) {
        const events = k.events.filter(e => e.length > 10).slice(0, 6);
        if (events.length > 0) {
            return `<p>Key events involving <strong>${k.name}</strong>:</p><ul>${events.map(e => `<li>${e}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find specific events for <strong>${k.name}</strong>.</p>`;
    },
    
    concept(k) {
        const sentences = Extractor.splitSentences(k.fullText).filter(s => s.length > 50 && s.length < 300).slice(0, 4);
        if (sentences.length === 0) {
            return `<p>I found records of <strong>${k.name}</strong>, but cannot provide a clear explanation.</p>`;
        }
        let response = `<p><strong>${k.name}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        return response;
    },
    
    comparison(k) {
        return `<p>Comparison requires two subjects. Please ask about two specific entities.</p>`;
    },
    
    list(k) {
        const sentences = Extractor.splitSentences(k.fullText).filter(s => s.length > 40 && s.length < 200).slice(0, 8);
        if (sentences.length > 0) {
            return `<p>Information about <strong>${k.name}</strong>:</p><ul>${sentences.map(s => `<li>${s}</li>`).join('')}</ul>`;
        }
        return `<p>I could not find a list for <strong>${k.name}</strong>.</p>`;
    },
    
    yesno(k, analysis) {
        const lower = k.fullText.toLowerCase();
        const claim = analysis.query.toLowerCase().replace(/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\s+/, '').replace(/[?.,!]$/, '');
        const claimWords = claim.split(/\s+/).filter(w => w.length > 3);
        
        let support = 0, negate = 0;
        const negateWords = ['not','never','no','without','neither','nor','none',"doesn't","isn't","wasn't","can't","won't","don't","didn't","hasn't"];
        
        const sentences = Extractor.splitSentences(k.fullText);
        for (const sent of sentences) {
            const s = sent.toLowerCase();
            const matches = claimWords.filter(w => s.includes(w)).length;
            if (matches >= Math.max(1, claimWords.length * 0.4)) {
                if (negateWords.some(n => s.includes(n))) negate++;
                else support += 2;
            }
        }
        
        if (support > negate && support > 0) return `<p>Yes — <strong>${k.name}</strong> ${claim}.</p>`;
        if (negate > support) return `<p>No — the archives indicate otherwise.</p>`;
        return `<p>The archives do not clearly confirm or deny this about <strong>${k.name}</strong>.</p>`;
    },
    
    overview(k) {
        const sentences = Extractor.splitSentences(k.fullText).filter(s => s.length > 40 && s.length < 250).slice(0, 3);
        if (sentences.length === 0) {
            return `<p>I found an article for <strong>${k.name}</strong>, but the excerpt is too brief.</p>`;
        }
        
        let response = `<p><strong>${k.name}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        
        const facts = [];
        if (k.attributes.birth) facts.push(`Born: ${k.attributes.birth}`);
        if (k.places.length > 0) facts.push(`From: ${k.places[0]}`);
        if (k.abilities.length > 0) facts.push(`Abilities: Yes`);
        
        if (facts.length > 0) {
            response += `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;"><strong>Quick facts:</strong> ${facts.join(' • ')}</p>`;
        }
        
        return response;
    }
};

// ==================== SCHOLAR ORCHESTRATOR ====================
const Scholar = {
    async process(query) {
        // Phase 1: Analyze
        const analysis = Analyzer.analyze(query);
        console.log('Analysis:', analysis);
        
        // Phase 2: Search with smart ranking
        const searchResults = await SearchEngine.findArticles(analysis);
        if (!searchResults.length) {
            return this.noResults(query);
        }
        
        // Phase 3: Fetch top result
        const topResult = searchResults[0];
        console.log('Top result:', topResult.title);
        
        const page = await API.getPage(topResult.title);
        if (!page || !page.wikitext || page.wikitext.length < 100) {
            return this.noResults(query);
        }
        
        // Phase 4: Parse
        const parsed = Parser.parse(page);
        
        // Phase 5: Extract knowledge
        const knowledge = Extractor.extract(parsed);
        console.log('Knowledge:', { name: knowledge.name, type: knowledge.type, attributes: knowledge.attributes });
        
        // Phase 6: Update context
        State.context.lastEntity = knowledge.name;
        State.context.lastTopic = analysis.intent;
        
        // Phase 7: Generate answer
        return AnswerEngine.generate(analysis, knowledge);
    },
    
    noResults(query) {
        return {
            text: `<p>I searched the Coppermind but could not find clear information about "<strong>${escapeHtml(query)}</strong>".</p><p>Try the exact name from the books, or ask about a general topic.</p>`,
            meta: { confidence: 'low', sources: [] }
        };
    }
};

// ==================== UTILITIES ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
