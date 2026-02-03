require('dotenv').config();
const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const AMAZON_AFFILIATE_TAG = process.env.AMAZON_TAG || 'sdjjn09-21';
const NEW_DEALS_FILE = 'new_deals.json';
const LAST_POSTED_FILE = 'last_posted.json';
const DISCOUNT_FILTER = '&discounts-widget=%2522%257B%255C%2522state%255C%2522%253A%257B%255C%2522refinementFilters%255C%2522%253A%257B%255C%2522reviewRating%255C%2522%253A%255B%255C%25224%255C%2522%255D%257D%252C%255C%2522rangeRefinementFilters%255C%2522%253A%257B%255C%2522percentOff%255C%2522%253A%257B%255C%2522min%255C%2522%253A50%252C%255C%2522max%255C%2522%253A100%257D%257D%257D%252C%255C%2522version%255C%2522%253A1%257D%2522';

const generateLinkId = () => uuidv4();
const AMAZON_DEALS_BASE = `https://www.amazon.in/deals?ref_=nav_cs_gb`;

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
];

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

async function fetchProductDetails(page, url) {
    try {
        console.log(`Fetching details for: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const details = await page.evaluate(() => {
            const priceWhole = document.querySelector('span.a-price-whole')?.textContent.trim();
            const discount = document.querySelector('.savingPriceOverride, .base-price-percentage')?.textContent.trim();
            
            return {
                price_after_discount: priceWhole ? `₹${priceWhole}` : 'N/A',
                discount: discount || '50%+'
            };
        });
        return details;
    } catch (error) {
        console.error(`Error fetching product details for ${url}:`, error.message);
        return { price_after_discount: 'N/A', discount: '50%+' };
    }
}


async function scrapeCategory(page, category) {
    try {
        console.log(`Scraping Amazon category: ${category.name}`);
        try {
            await page.setViewport({ width: 1280, height: 2000 });
            console.log(`Navigating to: ${category.url}`);
            await page.goto(category.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
            
            await page.waitForSelector('[data-testid="grid-deals-container"], .grid-deals-container, #slot-15', { timeout: 30000 }).catch(e => console.log('Wait timeout, continuing...'));
            
            await autoScroll(page);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            await page.screenshot({ path: 'amazon_deals_screenshot.png' });
        } catch (e) {
            console.log(`Navigation error: ${e.message}`);
        }
        
        const dealElements = await page.$$('.ProductCard-module__card, [class*="ProductCard-module__card"], [data-testid="deal-card"]');
        console.log(`Found ${dealElements.length} potential deal cards in ${category.name}`);

        const deals = [];
        for (const element of dealElements) {
            const dealData = await page.evaluate((el) => {
                const titleElement = el.querySelector('span#dealTitle, span[class*="a-truncate-full"], p[class*="ProductCard-module__title"], .a-size-base');
                const title = titleElement ? titleElement.textContent.trim() : '';
                
                const urlElement = el.querySelector('a.a-link-normal');
                const rawUrl = urlElement ? urlElement.href : '';
                
               const imageElement = el.querySelector('img');
                    
                    let imageUrl = '';
                    if (imageElement) {
                      // 1️⃣ Check <picture> sources first
                      const picture = imageElement.closest('picture');
                      if (picture) {
                        const sources = picture.querySelectorAll('source');
                    
                        for (const source of sources) {
                          const srcset = source.getAttribute('srcset');
                          if (!srcset) continue;
                    
                          const match = srcset.match(/([^,\s]+)\s2x/);
                          if (match) {
                            imageUrl = match[1];
                            break;
                          }
                        }
                      }
                    
                      // 2️⃣ Fallback: img srcset
                      if (!imageUrl && imageElement.srcset) {
                        const match = imageElement.srcset.match(/([^,\s]+)\s2x/);
                        if (match) {
                          imageUrl = match[1];
                        }
                      }
                    
                      // 3️⃣ Final fallback
                      if (!imageUrl) {
                        imageUrl = imageElement.src;
                      }
                    }


                
                const asinMatch = rawUrl.match(/\/dp\/([A-Z0-9]{10})/) || rawUrl.match(/\/deal\/([A-Z0-9]{10})/) || rawUrl.match(/\/product\/([A-Z0-9]{10})/);
                const asin = asinMatch ? asinMatch[1] : null;

                return { title, rawUrl, asin, imageUrl };
            }, element);

            if (dealData.asin && dealData.title) {
                // To keep it fast, we can extract discount from the card if available
                const discount = await element.$eval('.a-badge-text, .a-size-mini', el => el.textContent.trim()).catch(() => '50%+');
                
                const cleanUrl = `https://www.amazon.in/dp/${dealData.asin}?tag=${AMAZON_AFFILIATE_TAG}`;
                
                deals.push({
                    asin: dealData.asin,
                    title: dealData.title,
                    discount: discount,
                    imageUrl: dealData.imageUrl,
                    affiliate_link: cleanUrl,
                    link: `https://www.amazon.in/dp/${dealData.asin}`
                });
            }
        }
        return deals;
    } catch (error) {
        console.error(`Amazon ${category.name} scrape failed:`, error.message);
        return [];
    }
}

async function main() {
    let browser;
    try {
        const launchOptions = {
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            timeout: 60000
        };

        // Auto-detect Chrome executable path
        if (process.platform === 'win32') {
            // Your Windows path
            launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        } else {
            // GitHub Actions (Ubuntu) path
            launchOptions.executablePath = '/usr/bin/google-chrome';
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent(userAgents[0]);
        await page.setViewport({ width: 1280, height: 1280 });

        const categories = [
            { name: 'Today\'s Deals', url: `${AMAZON_DEALS_BASE}${DISCOUNT_FILTER}` }
        ];

        let allDeals = [];
        for (const category of categories) {
            const categoryDeals = await scrapeCategory(page, category);
            allDeals.push(...categoryDeals);
        }

        // Deduplicate
        const uniqueDealsMap = new Map();
        allDeals.forEach(deal => uniqueDealsMap.set(deal.asin, deal));
        const uniqueDeals = Array.from(uniqueDealsMap.values());

        console.log(`Total unique deals found: ${uniqueDeals.length}`);

        // Filter against last_posted
        let lastPosted = [];
        try {
            const data = await fs.readFile(LAST_POSTED_FILE, 'utf8');
            lastPosted = JSON.parse(data);
        } catch (e) {}

        const newDeals = uniqueDeals.filter(deal => !lastPosted.includes(deal.link));
        console.log(`New deals to post: ${newDeals.length}`);

        await fs.writeFile(NEW_DEALS_FILE, JSON.stringify(newDeals, null, 4));
        console.log(`Saved ${newDeals.length} new deals to ${NEW_DEALS_FILE}`);

    } catch (error) {
        console.error('Scrape error:', error);
    } finally {
        if (browser) await browser.close();
    }
}

main();
