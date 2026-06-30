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
                <p>Greetings, traveler. I am the Coppermind Scholar. Ask me anything about Brandon Sanderson's Cosmere — characters, shards, magic systems, worlds, or events.</p>
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
    async search(query, limit = 10) {
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
    
    async openSearch(query, limit = 8) {
        try {
            const params = new URLSearchParams({
                action: 'opensearch', search: query, limit, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            return data[1] || [];
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
    },
    
    async getPages(titles) {
        const results = [];
        for (const title of titles) {
            const page = await this.getPage(title);
            if (page) results.push(page);
        }
        return results;
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
            sections: this.parseSections(wikitext),
            introduction: this.cleanText(extract.substring(0, 2000)),
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
        // Remove template name (first line/word before first |)
        let content = templateContent;
        const firstPipe = content.indexOf('|');
        if (firstPipe > 0) content = content.substring(firstPipe + 1);
        
        // Split by | respecting nested structures
        const fields = this.splitByPipe(content);
        
        for (const field of fields) {
            const eq = field.indexOf('=');
            if (eq > 0) {
                let key = field.substring(0, eq).trim().toLowerCase();
                let value = field.substring(eq + 1).trim();
                value = this.cleanValue(value);
                
                if (key && value && value.length > 0 && value.length < 500) {
                    // Handle array values
                    const values = value.split(/,|<br\s*\/?>/).map(v => v.trim()).filter(v => v.length > 0 && !v.match(/^\W*$/));
                    if (values.length > 1) {
                        infobox[key] = values;
                    } else if (values.length === 1) {
                        infobox[key] = values[0];
                    }
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
        
        // Remove wiki links [[Target|Display]] -> Display
        value = value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
        value = value.replace(/\[\[([^\]]+)\]\]/g, '$1');
        
        // Remove templates recursively
        value = value.replace(/\{\{[^{}]*\}\}/g, '');
        value = value.replace(/\{\{[^{}]*\}\}/g, '');
        
        // Remove HTML
        value = value.replace(/<[^>]+>/g, ' ');
        
        // Remove refs
        value = value.replace(/<ref[^>]*>.*?<\/ref>/gi, '');
        value = value.replace(/<ref[^>]*\/>/gi, '');
        
        // Remove bold/italic
        value = value.replace(/'''?(.*?)'''?/g, '$1');
        value = value.replace(/''(.*?)''/g, '$1');
        
        // Clean up
        value = value.replace(/\s+/g, ' ').trim();
        value = value.replace(/^[,;\s]+|[,;\s]+$/g, '');
        value = value.replace(/\(\s*\)/g, '');
        
        return value;
    },
    
    parseSections(text) {
        const sections = [];
        if (!text) return sections;
        
        const lines = text.split('\n');
        let currentSection = null;
        let currentContent = [];
        
        for (const line of lines) {
            const headerMatch = line.match(/^(={2,4})\s*([^=]+?)\s*\1/);
            if (headerMatch) {
                if (currentSection) {
                    sections.push({
                        title: currentSection,
                        content: this.cleanValue(currentContent.join('\n'))
                    });
                }
                currentSection = headerMatch[2].trim();
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        }
        
        if (currentSection && currentContent.length) {
            sections.push({
                title: currentSection,
                content: this.cleanValue(currentContent.join('\n'))
            });
        }
        
        return sections;
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

// ==================== KNOWLEDGE GRAPH ====================
const KnowledgeGraph = {
    build(parsedPages) {
        const kg = {
            entities: new Map(),
            relationships: [],
            facts: []
        };
        
        for (const page of parsedPages) {
            const entity = this.extractEntity(page);
            kg.entities.set(page.title, entity);
            
            // Extract relationships
            const rels = this.extractRelationships(page);
            kg.relationships.push(...rels);
            
            // Extract facts
            const facts = this.extractFacts(page);
            kg.facts.push(...facts);
        }
        
        return kg;
    },
    
    extractEntity(page) {
        const e = {
            name: page.title,
            type: this.detectType(page),
            attributes: {},
            world: null,
            abilities: [],
            titles: [],
            relationships: [],
            appearances: [],
            description: page.introduction
        };
        
        const ib = page.infobox || {};
        
        // Birth/death
        if (ib.born || ib.birth) e.attributes.birth = ib.born || ib.birth;
        if (ib.died || ib.death) e.attributes.death = ib.died || ib.death;
        if (ib.age) e.attributes.age = ib.age;
        
        // World
        if (ib.world || ib.planet || ib.universe) {
            e.world = ib.world || ib.planet || ib.universe;
        }
        
        // Abilities
        if (ib.abilities || ib.powers || ib.skills || ib.magic) {
            const abs = ib.abilities || ib.powers || ib.skills || ib.magic;
            e.abilities = Array.isArray(abs) ? abs : [abs];
        }
        
        // Titles
        if (ib.titles || ib.occupation || ib.profession || ib.role) {
            const t = ib.titles || ib.occupation || ib.profession || ib.role;
            e.titles = Array.isArray(t) ? t : [t];
        }
        
        // Family
        if (ib.family || ib.parents || ib.spouse || ib.children || ib.relatives) {
            const rels = ib.family || ib.parents || ib.spouse || ib.children || ib.relatives;
            e.relationships = Array.isArray(rels) ? rels : [rels];
        }
        
        // Groups
        if (ib.groups || ib.affiliation || ib.allegiance || ib.crew || ib.house) {
            const g = ib.groups || ib.affiliation || ib.allegiance || ib.crew || ib.house;
            e.attributes.groups = Array.isArray(g) ? g : [g];
        }
        
        // Books
        if (ib.books || ib.appearances || ib.introduced) {
            const b = ib.books || ib.appearances || ib.introduced;
            e.appearances = Array.isArray(b) ? b : [b];
        }
        
        // Physical
        if (ib.hair || ib.eyes || ib.height || ib.skin || ib.appearance) {
            e.attributes.physical = {
                hair: ib.hair, eyes: ib.eyes, height: ib.height,
                skin: ib.skin, appearance: ib.appearance
            };
        }
        
        return e;
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
    
    extractRelationships(page) {
        const rels = [];
        const text = page.fullText || '';
        const sentences = this.splitSentences(text);
        
        const patterns = [
            { type: 'parent', regex: /(?:father|mother|parent)\s+(?:is|was)\s+([^.,;]{3,40})/i },
            { type: 'sibling', regex: /(?:brother|sister)\s+(?:is|was|named)\s+([^.,;]{3,40})/i },
            { type: 'spouse', regex: /(?:wife|husband|spouse|married\s+to)\s+(?:is|was|named)?\s*([^.,;]{3,40})/i },
            { type: 'child', regex: /(?:son|daughter)\s+(?:is|was|named)\s+([^.,;]{3,40})/i },
            { type: 'mentor', regex: /(?:mentor|teacher|master)\s+(?:is|was|named)\s+([^.,;]{3,40})/i },
            { type: 'enemy', regex: /(?:enemy|rival|opponent)\s+(?:is|was|named)\s+([^.,;]{3,40})/i }
        ];
        
        for (const sent of sentences) {
            for (const { type, regex } of patterns) {
                const match = sent.match(regex);
                if (match && match[1]) {
                    rels.push({
                        from: page.title,
                        type,
                        to: match[1].trim(),
                        context: sent
                    });
                }
            }
        }
        
        return rels;
    },
    
    extractFacts(page) {
        const facts = [];
        const text = page.fullText || '';
        const sentences = this.splitSentences(text);
        
        for (const sent of sentences) {
            const lower = sent.toLowerCase();
            
            // Event facts
            if (/\b(fought|battled|led|commanded|discovered|created|destroyed|saved|killed|defeated|betrayed|allied|joined|returned|escaped|rescued|survived|overthrew|united)\b/i.test(sent)) {
                facts.push({ type: 'event', subject: page.title, content: sent });
            }
            
            // Trait facts
            if (/\b(brave|coward|honest|kind|cruel|smart|clever|wise|foolish|depressed|happy|sad|angry|honorable|loyal|stubborn|determined|broken|idealistic|cynical|optimistic|pessimistic)\b/i.test(sent)) {
                facts.push({ type: 'trait', subject: page.title, content: sent });
            }
            
            // Possession facts
            if (/\b(has|possesses|wields|owns|carries|bears)\b/i.test(sent)) {
                facts.push({ type: 'possession', subject: page.title, content: sent });
            }
        }
        
        return facts;
    },
    
    splitSentences(text) {
        return text
            .replace(/([.!?])\s+/g, "$1|")
            .split("|")
            .map(s => s.trim())
            .filter(s => s.length > 15 && s.length < 400);
    }
};

// ==================== QUESTION ANALYZER ====================
const Analyzer = {
    analyze(query) {
        const lower = query.toLowerCase().replace(/[?.,!]/g, '');
        
        // Detect if follow-up
        const isFollowUp = State.context.lastEntity && 
            /^(what about|and |what |how about|tell me more|who else|where else|why |how |when |is |are |was |were |did |does |do |can |could |would |should |will |has |have |had )/i.test(query) &&
            query.length < 50;
        
        let processedQuery = query;
        if (isFollowUp && !query.toLowerCase().includes(State.context.lastEntity.toLowerCase())) {
            processedQuery = query + ' ' + State.context.lastEntity;
        }
        
        const entity = this.extractEntity(processedQuery);
        const intent = this.classifyIntent(lower, query);
        const focusWords = this.extractFocusWords(lower);
        
        return {
            query,
            processedQuery,
            entity,
            intent,
            focusWords,
            isFollowUp,
            original: query
        };
    },
    
    extractEntity(query) {
        // Remove question words
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
    },
    
    extractFocusWords(lower) {
        const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','can','could','may','might','must','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','under','and','but','or','yet','so','if','because','since','although','though','while','where','when','who','what','which','whom','whose','how','why','this','that','these','those','i','me','my','we','our','you','your','he','him','his','she','her','it','its','they','them','their','am','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','now','then','here','there','once','again','further','also','really','actually','probably','maybe','perhaps','still','yet','already','almost','quite','rather','pretty','fairly','somewhat','about','after','against','almost','already','although','always','among','amount','another','anyone','anything','around','away','back','became','because','become','before','behind','being','came','can','cannot','down','either','else','enough','even','ever','every','everyone','everything','far','further','get','gets','getting','given','gives','go','goes','going','gone','got','gotten','however','into','itself','keep','keeps','kept','last','least','less','let','lets','like','likely','made','make','makes','making','many','maybe','mine','mostly','much','must','myself','near','nearly','need','needs','neither','never','new','next','nobody','non','none','noone','nor','nothing','nowhere','off','often','oh','ok','okay','old','once','onto','others','ours','ourselves','out','outside','over','overall','part','parts','per','perhaps','please','put','puts','quite','re','right','said','same','saw','say','says','second','seconds','see','seem','seemed','seeming','seems','sees','several','shall','show','showed','showing','shows','side','sides','since','small','smaller','smallest','somebody','someone','something','somewhere','state','states','sure','take','taken','takes','taking','than','that','the','them','themselves','then','there','therefore','these','they','thing','things','think','thinks','this','those','though','thought','thoughts','thousand','three','through','throughout','thus','today','together','took','toward','towards','trillion','try','trying','turn','turned','turning','turns','two','under','unless','until','up','upon','us','use','used','uses','using','very','via','want','wanted','wanting','wants','way','ways','well','wells','went','what','whatever','when','whenever','where','whereas','wherever','whether','which','while','who','whoever','whole','whom','whose','why','will','within','without','work','worked','working','works','would','year','years','yes','yet','young','younger','youngest','your','yours','yourself','yourselves']);
        
        return lower.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    }
};

// ==================== ANSWER ENGINE ====================
const AnswerEngine = {
    generate(analysis, kg, pages) {
        const { intent } = analysis;
        const mainEntity = kg.entities.get(pages[0].title);
        const mainPage = pages[0];
        
        const handlers = {
            birth: () => this.answerBirth(mainEntity, mainPage, kg),
            death: () => this.answerDeath(mainEntity, mainPage, kg),
            age: () => this.answerAge(mainEntity, mainPage, kg),
            appearance: () => this.answerAppearance(mainEntity, mainPage, kg),
            family: () => this.answerFamily(mainEntity, mainPage, kg),
            abilities: () => this.answerAbilities(mainEntity, mainPage, kg),
            role: () => this.answerRole(mainEntity, mainPage, kg),
            origin: () => this.answerOrigin(mainEntity, mainPage, kg),
            appearances: () => this.answerAppearances(mainEntity, mainPage, kg),
            personality: () => this.answerPersonality(mainEntity, mainPage, kg),
            events: () => this.answerEvents(mainEntity, mainPage, kg),
            concept: () => this.answerConcept(mainEntity, mainPage, kg),
            comparison: () => this.answerComparison(pages, kg, analysis),
            list: () => this.answerList(mainEntity, mainPage, kg),
            yesno: () => this.answerYesNo(mainEntity, mainPage, kg, analysis),
            overview: () => this.answerOverview(mainEntity, mainPage, kg)
        };
        
        let result = handlers[intent] || handlers.overview;
        let response = result();
        let confidence = 'high';
        
        // Fallback
        if (response.includes('could not find') || response.includes('not specified')) {
            if (intent !== 'overview') {
                const fallback = this.answerOverview(mainEntity, mainPage, kg);
                if (!fallback.includes('could not find')) {
                    response = `<p>I could not find a direct answer to your specific question, but here is what I know about <strong>${mainPage.title}</strong>:</p>` + fallback;
                    confidence = 'medium';
                }
            }
        }
        
        if (response.includes('could not find') || response.includes('not specified')) {
            confidence = 'low';
        }
        
        return { text: response, meta: { confidence, sources: pages.slice(0, 3).map(p => p.title) } };
    },
    
    answerBirth(entity, page, kg) {
        const birth = entity?.attributes?.birth;
        if (birth && birth.length > 2 && !birth.match(/^\W*$/)) {
            return `<p><strong>${entity.name}</strong> was born in <strong>${birth}</strong>.</p>`;
        }
        
        const text = page.fullText || '';
        const match = text.match(/born\s+(?:in|on)?\s*(\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
        if (match && match[1]) {
            return `<p><strong>${entity.name}</strong> was born in <strong>${match[1]}</strong>.</p>`;
        }
        
        return `<p>I could not find a specific birth date for <strong>${entity.name}</strong> in the archives.</p>`;
    },
    
    answerDeath(entity, page, kg) {
        const death = entity?.attributes?.death;
        if (death && death.length > 2 && !death.match(/^\W*$/)) {
            return `<p><strong>${entity.name}</strong> died in <strong>${death}</strong>.</p>`;
        }
        
        const text = page.fullText || '';
        const match = text.match(/(?:died|death|killed|slain)\s+(?:in|on)?\s*(\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
        if (match && match[1]) {
            return `<p><strong>${entity.name}</strong> died in <strong>${match[1]}</strong>.</p>`;
        }
        
        if (/\b(still alive|currently|survived)\b/i.test(text)) {
            return `<p><strong>${entity.name}</strong> is still alive according to the archives.</p>`;
        }
        
        return `<p>I could not find a death date for <strong>${entity.name}</strong>. They may still be alive.</p>`;
    },
    
    answerAge(entity, page, kg) {
        const age = entity?.attributes?.age;
        if (age && age.length > 0 && !age.match(/^\W*$/)) {
            return `<p><strong>${entity.name}</strong> is <strong>${age}</strong> old.</p>`;
        }
        
        const text = page.fullText || '';
        const ageMatch = text.match(/(?:is|was|age[d\s]+)\s+(\d+)\s+years?\s+old/i);
        if (ageMatch) {
            return `<p><strong>${entity.name}</strong> is <strong>${ageMatch[1]} years old</strong>.</p>`;
        }
        
        const birthMatch = text.match(/born\s+(?:in\s+)?(\d{4})/i);
        if (birthMatch) {
            const year = parseInt(birthMatch[1]);
            const present = this.inferPresentYear(text);
            return `<p><strong>${entity.name}</strong> was born in <strong>${year}</strong>, making them approximately <strong>${present - year} years old</strong>.</p>`;
        }
        
        return `<p>I could not determine the age of <strong>${entity.name}</strong>.</p>`;
    },
    
    answerAppearance(entity, page, kg) {
        const physical = entity?.attributes?.physical;
        const traits = [];
        
        if (physical) {
            if (physical.hair) traits.push(`Hair: ${physical.hair}`);
            if (physical.eyes) traits.push(`Eyes: ${physical.eyes}`);
            if (physical.height) traits.push(`Height: ${physical.height}`);
            if (physical.skin) traits.push(`Skin: ${physical.skin}`);
        }
        
        const text = page.fullText || '';
        const sentences = this.splitSentences(text).slice(0, 10);
        for (const sent of sentences) {
            const lower = sent.toLowerCase();
            if ((lower.includes('hair') || lower.includes('eyes') || lower.includes('skin') || 
                 lower.includes('tall') || lower.includes('build') || lower.includes('appearance')) &&
                sent.length > 20 && sent.length < 200) {
                traits.push(sent);
            }
        }
        
        if (traits.length > 0) {
            let response = `<p><strong>${entity.name}</strong> is described as follows:</p><ul>`;
            for (const t of traits.slice(0, 5)) {
                response += `<li>${t}</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find a detailed physical description of <strong>${entity.name}</strong>.</p>`;
    },
    
    answerFamily(entity, page, kg) {
        const rels = entity?.relationships || [];
        const relationships = kg.relationships.filter(r => r.from === entity.name);
        
        if (rels.length > 0 || relationships.length > 0) {
            let response = `<p><strong>${entity.name}'s</strong> family and relationships:</p><ul>`;
            
            for (const r of rels.slice(0, 6)) {
                if (r.length > 2 && !r.match(/^\W*$/)) response += `<li>${r}</li>`;
            }
            
            for (const r of relationships.slice(0, 6)) {
                response += `<li>${r.type}: ${r.to}</li>`;
            }
            
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find detailed family information for <strong>${entity.name}</strong>.</p>`;
    },
    
    answerAbilities(entity, page, kg) {
        const abilities = entity?.abilities || [];
        
        if (abilities.length > 0) {
            let response = `<p><strong>${entity.name}</strong> possesses the following abilities:</p><ul>`;
            for (const a of abilities.slice(0, 8)) {
                if (a.length > 2 && !a.match(/^\W*$/)) response += `<li><strong>${a}</strong></li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        const text = page.fullText || '';
        const abilityMap = {
            'Allomancy': ['allomancer','allomancy','mistborn','soothing','rioting','coinshot','tineye'],
            'Feruchemy': ['feruchemist','feruchemy','metalmind','twinborn'],
            'Surgebinding': ['surgebinder','surgebinding','knight radiant','radiant','spren','windrunner','lightweaver'],
            'Awakening': ['awakener','awakening','breath','biochroma'],
            'AonDor': ['aondor','elantrian','sel'],
            'Hemalurgy': ['hemalurgist','hemalurgy','spike'],
            'Shardblade': ['shardblade','honorblade'],
            'Compounding': ['compounding','compound']
        };
        
        const found = [];
        const lower = text.toLowerCase();
        for (const [name, keywords] of Object.entries(abilityMap)) {
            if (keywords.some(k => lower.includes(k))) found.push(name);
        }
        
        if (found.length > 0) {
            let response = `<p><strong>${entity.name}</strong> possesses:</p><ul>`;
            for (const a of found) response += `<li><strong>${a}</strong></li>`;
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find specific abilities listed for <strong>${entity.name}</strong>.</p>`;
    },
    
    answerRole(entity, page, kg) {
        const titles = entity?.titles || [];
        
        if (titles.length > 0) {
            const clean = titles.filter(t => t.length > 2 && !t.match(/^\W*$/)).slice(0, 5);
            if (clean.length > 0) {
                return `<p><strong>${entity.name}</strong> is ${clean.join(', ')}.</p>`;
            }
        }
        
        const text = page.fullText || '';
        const rolePatterns = [
            { name: 'Knight Radiant', keywords: ['knight radiant','radiant','windrunner','lightweaver'] },
            { name: 'Soldier', keywords: ['soldier','warrior','bridgeman','army'] },
            { name: 'Noble', keywords: ['noble','lord','lady','highprince','king','queen','emperor'] },
            { name: 'Thief', keywords: ['thief','criminal'] },
            { name: 'Scholar', keywords: ['scholar','ardent'] },
            { name: 'Surgeon', keywords: ['surgeon','healer'] }
        ];
        
        const found = [];
        const lower = text.toLowerCase();
        for (const { name, keywords } of rolePatterns) {
            if (keywords.some(k => lower.includes(k))) found.push(name);
        }
        
        if (found.length > 0) {
            return `<p><strong>${entity.name}</strong> is ${found.slice(0, 4).join(', ')}.</p>`;
        }
        
        return `<p>I could not determine the specific role of <strong>${entity.name}</strong>.</p>`;
    },
    
    answerOrigin(entity, page, kg) {
        const world = entity?.world;
        if (world && world.length > 1 && !world.match(/^\W*$/)) {
            return `<p><strong>${entity.name}</strong> is from <strong>${world}</strong>.</p>`;
        }
        
        const text = page.fullText || '';
        const worldMap = {
            'Roshar': ['roshar','alethkar','shadesmar','urithiru'],
            'Scadrial': ['scadrial','final empire','elendel','mistborn'],
            'Nalthis': ['nalthis','hallandren','warbreaker'],
            'Sel': ['sel','elantris','fjorden']
        };
        
        const lower = text.toLowerCase();
        for (const [name, keywords] of Object.entries(worldMap)) {
            if (keywords.some(k => lower.includes(k))) {
                return `<p><strong>${entity.name}</strong> is from <strong>${name}</strong>.</p>`;
            }
        }
        
        return `<p>I could not determine the origin of <strong>${entity.name}</strong>.</p>`;
    },
    
    answerAppearances(entity, page, kg) {
        const books = entity?.appearances || [];
        
        if (books.length > 0) {
            const clean = books.filter(b => b.length > 2 && !b.match(/^\W*$/)).slice(0, 10);
            if (clean.length > 0) {
                return `<p><strong>${entity.name}</strong> appears in:</p><ul>${clean.map(b => `<li>${b}</li>`).join('')}</ul>`;
            }
        }
        
        const text = page.fullText || '';
        const bookNames = ['The Way of Kings','Words of Radiance','Oathbringer','Rhythm of War','Wind and Truth','Mistborn','The Final Empire','The Well of Ascension','The Hero of Ages','Elantris','Warbreaker','Arcanum Unbounded'];
        const found = [];
        
        for (const book of bookNames) {
            if (text.includes(book) && !found.includes(book)) found.push(book);
        }
        
        if (found.length > 0) {
            return `<p><strong>${entity.name}</strong> appears in:</p><ul>${found.map(b => `<li>${b}</li>`).join('')}</ul>`;
        }
        
        return `<p>I could not find specific book appearances for <strong>${entity.name}</strong>.</p>`;
    },
    
    answerPersonality(entity, page, kg) {
        const text = page.fullText || '';
        const sentences = this.splitSentences(text).slice(0, 12);
        const traits = [];
        
        for (const sent of sentences) {
            const lower = sent.toLowerCase();
            if ((lower.includes('personality') || lower.includes('honor') || lower.includes('determined') ||
                 lower.includes('broken') || lower.includes('struggles') || lower.includes('depression') ||
                 lower.includes('brave') || lower.includes('stubborn') || lower.includes('loyal') ||
                 lower.includes('kind') || lower.includes('cruel') || lower.includes('proud')) &&
                sent.length > 30 && sent.length < 250) {
                traits.push(sent);
            }
        }
        
        if (traits.length > 0) {
            let response = `<p><strong>${entity.name}'s</strong> personality and character:</p><ul>`;
            for (const t of traits.slice(0, 5)) response += `<li>${t}.</li>`;
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find detailed personality information for <strong>${entity.name}</strong>.</p>`;
    },
    
    answerEvents(entity, page, kg) {
        const facts = kg.facts.filter(f => f.subject === entity.name && f.type === 'event').slice(0, 6);
        
        if (facts.length > 0) {
            let response = `<p>Key events involving <strong>${entity.name}</strong>:</p><ul>`;
            for (const f of facts) response += `<li>${f.content}.</li>`;
            response += `</ul>`;
            return response;
        }
        
        const text = page.fullText || '';
        const sentences = this.splitSentences(text).filter(s => 
            /\b(fought|battled|led|commanded|discovered|created|destroyed|saved|killed|defeated|betrayed|allied|joined|returned|escaped|rescued|survived|overthrew)\b/i.test(s)
        ).slice(0, 6);
        
        if (sentences.length > 0) {
            let response = `<p>Key events involving <strong>${entity.name}</strong>:</p><ul>`;
            for (const s of sentences) response += `<li>${s}.</li>`;
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find specific events involving <strong>${entity.name}</strong>.</p>`;
    },
    
    answerConcept(entity, page, kg) {
        const sentences = this.splitSentences(page.fullText || '').filter(s => s.length > 50 && s.length < 300).slice(0, 4);
        
        if (sentences.length === 0) {
            return `<p>I found records of <strong>${entity.name}</strong>, but the excerpts do not contain a clear explanation.</p>`;
        }
        
        let response = `<p><strong>${entity.name}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        return response;
    },
    
    answerComparison(pages, kg, analysis) {
        if (pages.length < 2) {
            return `<p>To compare two subjects, I need to identify both clearly in the archives.</p>`;
        }
        
        const [p1, p2] = pages;
        const e1 = kg.entities.get(p1.title);
        const e2 = kg.entities.get(p2.title);
        
        let response = `<p>Comparison of <strong>${p1.title}</strong> and <strong>${p2.title}</strong>:</p>`;
        
        const s1 = this.splitSentences(p1.fullText || '').filter(s => s.length > 40);
        const s2 = this.splitSentences(p2.fullText || '').filter(s => s.length > 40);
        
        response += `<p><strong>${p1.title}:</strong> ${s1[0] || 'Limited information'}.</p>`;
        response += `<p><strong>${p2.title}:</strong> ${s2[0] || 'Limited information'}.</p>`;
        
        if (e1?.world && e2?.world) {
            response += `<p>Both are from <strong>${e1.world === e2.world ? e1.world : 'different worlds'}</strong>.</p>`;
        }
        
        return response;
    },
    
    answerList(entity, page, kg) {
        const text = page.fullText || '';
        const sentences = this.splitSentences(text).filter(s => s.length > 40 && s.length < 200).slice(0, 8);
        
        if (sentences.length > 0) {
            let response = `<p>Information about <strong>${entity.name}</strong>:</p><ul>`;
            for (const s of sentences) response += `<li>${s}</li>`;
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find a clear list for <strong>${entity.name}</strong>.</p>`;
    },
    
    answerYesNo(entity, page, kg, analysis) {
        const text = page.fullText || '';
        const lower = text.toLowerCase();
        const claim = analysis.query.toLowerCase().replace(/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\s+/, '').replace(/[?.,!]$/, '');
        const claimWords = claim.split(/\s+/).filter(w => w.length > 3);
        
        let support = 0, negate = 0;
        const negateWords = ['not','never','no','without','neither','nor','none',"doesn't","isn't","wasn't","can't","won't","don't","didn't","hasn't"];
        
        const sentences = this.splitSentences(text);
        for (const sent of sentences) {
            const s = sent.toLowerCase();
            const matches = claimWords.filter(w => s.includes(w)).length;
            if (matches >= Math.max(1, claimWords.length * 0.4)) {
                if (negateWords.some(n => s.includes(n))) negate++;
                else support += 2;
            }
        }
        
        if (support > negate && support > 0) {
            return `<p>Yes — according to the archives, <strong>${entity.name}</strong> ${claim}.</p>`;
        } else if (negate > support) {
            return `<p>No — the archives indicate otherwise regarding <strong>${entity.name}</strong>.</p>`;
        } else {
            return `<p>The archives contain information about <strong>${entity.name}</strong>, but do not clearly confirm or deny this.</p>`;
        }
    },
    
    answerOverview(entity, page, kg) {
        const sentences = this.splitSentences(page.fullText || '').filter(s => s.length > 40 && s.length < 250).slice(0, 3);
        
        if (sentences.length === 0) {
            return `<p>I found an article for <strong>${entity.name}</strong>, but the excerpt is too brief.</p>`;
        }
        
        let response = `<p><strong>${entity.name}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        
        const facts = [];
        if (entity?.attributes?.birth) facts.push(`Born: ${entity.attributes.birth}`);
        if (entity?.world) facts.push(`From: ${entity.world}`);
        if (entity?.abilities?.length) facts.push(`Abilities: Yes`);
        
        if (facts.length > 0) {
            response += `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;"><strong>Quick facts:</strong> ${facts.join(' • ')}</p>`;
        }
        
        return response;
    },
    
    inferPresentYear(text) {
        const lower = text.toLowerCase();
        if (lower.includes('scadrial') || lower.includes('mistborn') || lower.includes('elendel')) return 348;
        if (lower.includes('nalthis') || lower.includes('warbreaker') || lower.includes('hallandren')) return 328;
        if (lower.includes('sel') || lower.includes('elantris')) return 928;
        return 1175;
    },
    
    splitSentences(text) {
        return text.replace(/([.!?])\s+/g, "$1|").split("|").map(s => s.trim()).filter(s => s.length > 15);
    }
};

// ==================== SCHOLAR ORCHESTRATOR ====================
const Scholar = {
    async process(query) {
        // Phase 1: Analyze
        const analysis = Analyzer.analyze(query);
        console.log('Analysis:', analysis);
        
        // Phase 2: Search
        const searchResults = await this.search(analysis);
        if (!searchResults.length) {
            return this.noResults(query);
        }
        
        // Phase 3: Ingest
        const pages = await API.getPages(searchResults.map(r => r.title).slice(0, 5));
        if (!pages.length) {
            return this.noResults(query);
        }
        
        // Phase 4: Parse
        const parsedPages = pages.map(p => Parser.parse(p));
        
        // Phase 5: Build Knowledge Graph
        const kg = KnowledgeGraph.build(parsedPages);
        
        // Phase 6: Update context
        State.context.lastEntity = parsedPages[0].title;
        State.context.lastTopic = analysis.intent;
        
        // Phase 7: Generate answer
        return AnswerEngine.generate(analysis, kg, parsedPages);
    },
    
    async search(analysis) {
        const { entity, query } = analysis;
        const results = [];
        
        // Strategy 1: Direct search
        const s1 = await API.search(query, 8);
        results.push(...s1);
        
        // Strategy 2: Entity search
        if (entity && entity !== query && entity.length > 2) {
            const s2 = await API.search(entity, 5);
            for (const r of s2) {
                if (!results.find(x => x.title === r.title)) results.push(r);
            }
        }
        
        // Strategy 3: OpenSearch
        const s3 = await API.openSearch(entity || query, 5);
        for (const title of s3) {
            if (!results.find(x => x.title === title)) {
                results.push({ title, score: 50 });
            }
        }
        
        return results.sort((a, b) => (b.score || 0) - (a.score || 0));
    },
    
    noResults(query) {
        return {
            text: `<p>I searched the Coppermind but found no articles matching "<strong>${escapeHtml(query)}</strong>".</p><p>Try using the exact name from the books, or ask about a general topic like "Surgebinding" or "Roshar".</p>`,
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
