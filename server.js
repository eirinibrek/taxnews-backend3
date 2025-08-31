const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const cron = require('node-cron');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const parser = new Parser();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// In-memory storage (use database in production)
let newsCache = [];
let lastUpdate = null;

// RSS Sources
const rssSources = [
    {
        id: 'taxheaven',
        name: 'Taxheaven.gr',
        url: 'https://www.taxheaven.gr/rss/news.xml',
        category: 'taxation',
        priority: 'high'
    },
    {
        id: 'kathimerini-economy',
        name: 'Καθημερινή - Οικονομία',
        url: 'https://www.kathimerini.gr/rss/economy',
        category: 'economy',
        priority: 'high'
    },
    {
        id: 'capital',
        name: 'Capital.gr',
        url: 'https://www.capital.gr/rss',
        category: 'economy',
        priority: 'high'
    },
    {
        id: 'naftemporiki',
        name: 'Ναυτεμπορική',
        url: 'https://www.naftemporiki.gr/rss',
        category: 'economy',
        priority: 'medium'
    }
];

// Fetch RSS function
async function fetchRSSFeed(source) {
    try {
        console.log(`Fetching ${source.name}...`);
        const feed = await parser.parseURL(source.url);
        
        return feed.items.map(item => ({
            id: `${source.id}_${item.guid || item.link}`,
            title: item.title,
            summary: item.contentSnippet || item.content || '',
            content: item.content || item.contentSnippet || '',
            source: source.id,
            sourceName: source.name,
            category: source.category,
            priority: determinePriority(item.title, item.contentSnippet),
            tags: extractTags(item.title, item.contentSnippet),
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
            url: item.link,
            author: item.creator || source.name,
            isBreaking: isBreakingNews(item.title, item.contentSnippet)
        }));
    } catch (error) {
        console.error(`Error fetching ${source.name}:`, error.message);
        return [];
    }
}

// Helper functions
function determinePriority(title, description) {
    const text = (title + ' ' + (description || '')).toLowerCase();
    const highPriorityKeywords = ['επείγ', 'προσοχή', 'λήγει', 'τελευταί', 'άμεσα'];
    const mediumPriorityKeywords = ['σημαντικ', 'νέ', 'αλλαγ', 'ανακοίνωση'];
    
    if (highPriorityKeywords.some(keyword => text.includes(keyword))) return 'high';
    if (mediumPriorityKeywords.some(keyword => text.includes(keyword))) return 'medium';
    return 'low';
}

function isBreakingNews(title, description) {
    const text = (title + ' ' + (description || '')).toLowerCase();
    const breakingKeywords = ['επείγ', 'breaking', 'έκτακτο', 'προσοχή'];
    return breakingKeywords.some(keyword => text.includes(keyword));
}

function extractTags(title, description) {
    const text = (title + ' ' + (description || '')).toLowerCase();
    const tags = [];
    
    const tagKeywords = {
        'Νέο': ['νέ', 'καινούργι'],
        'Επείγον': ['επείγ', 'άμεσα'],
        'Φορολογία': ['φόρος', 'φπα', 'φορολογ'],
        'Επιδότηση': ['επιδότηση', 'χρηματοδότηση']
    };

    for (const [tag, keywords] of Object.entries(tagKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            tags.push(tag);
        }
    }
    
    return tags.slice(0, 3);
}

// Fetch all news
async function fetchAllNews() {
    console.log('Starting RSS fetch...');
    const allNews = [];
    
    for (const source of rssSources) {
        const news = await fetchRSSFeed(source);
        allNews.push(...news);
    }
    
    // Sort by date
    allNews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    
    newsCache = allNews;
    lastUpdate = new Date().toISOString();
    
    console.log(`Fetched ${allNews.length} articles`);
    return allNews;
}

// API Routes
app.get('/api/news', async (req, res) => {
    try {
        // If cache is empty or older than 10 minutes, refresh
        if (!newsCache.length || !lastUpdate || 
            (Date.now() - new Date(lastUpdate).getTime()) > 10 * 60 * 1000) {
            await fetchAllNews();
        }
        
        res.json({
            success: true,
            data: newsCache,
            lastUpdate: lastUpdate,
            total: newsCache.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/sources', (req, res) => {
    res.json({
        success: true,
        data: rssSources.map(source => ({
            ...source,
            status: 'online', // You can implement actual status checking
            lastFetch: lastUpdate
        }))
    });
});

app.post('/api/refresh', async (req, res) => {
    try {
        const news = await fetchAllNews();
        res.json({
            success: true,
            message: 'News refreshed successfully',
            total: news.length,
            lastUpdate: lastUpdate
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Auto-refresh every 10 minutes
cron.schedule('*/10 * * * *', () => {
    console.log('Auto-refreshing news...');
    fetchAllNews();
});

// Initial fetch
fetchAllNews();

app.listen(PORT, () => {
    console.log(`🚀 TaxNews API Server running on port ${PORT}`);
});
