require('dotenv').config();
const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const shortLinkCache = new Map();

// Configuration
const AMAZON_AFFILIATE_TAG = process.env.AMAZON_TAG || 'ascal-21';
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



async function getAmazonShortUrl(browser, mainPage, longUrl) {
    let shortPage;

    try {
        // ✅ cache hit
        if (shortLinkCache.has(longUrl)) {
            return shortLinkCache.get(longUrl);
        }

        const shortApi =
            `https://www.amazon.in/associates/sitestripe/getShortUrl?longUrl=${encodeURIComponent(longUrl)}&marketplaceId=44571&storeId=${AMAZON_AFFILIATE_TAG}`;

        // ✅ check for manual_cookies.json first (Fast-path: no browser tab needed)
        try {
            const manualPath = path.join(__dirname, 'manual_cookies.json');
            const manualRaw = await fs.readFile(manualPath, 'utf8');
            const manualConfig = JSON.parse(manualRaw);
            if (manualConfig && manualConfig.cookie_string) {
                const res = await fetch(shortApi, {
                    method: "GET",
                    headers: {
                        "accept": "application/json, text/javascript, */*; q=0.01",
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
                        "x-requested-with": "XMLHttpRequest",
                        "cookie": manualConfig.cookie_string,
                        "referer": longUrl
                    }
                });
                const text = await res.text();
                if (!text.trim().toLowerCase().startsWith('<!doctype html') && !text.trim().toLowerCase().startsWith('<html')) {
                    const json = JSON.parse(text);
                    if (json && (json.shortUrl || json.longUrl)) {
                        const result = {
                            affiliate_link: json.shortUrl || json.longUrl || longUrl,
                            longurl: json.longUrl || longUrl
                        };
                        shortLinkCache.set(longUrl, result);
                        return result;
                    }
                }
            }
        } catch (e) {
            // manual_cookies.json missing or invalid, fall back to browser profile below
        }

        shortPage = await browser.newPage();
        await shortPage.setUserAgent(userAgents[0]);

        // ✅ copy cookies from main page
        const cookies = await mainPage.cookies();
        if (cookies.length) {
            await shortPage.setCookie(...cookies);
        }

        // ✅ activate amazon.in domain cookies
        await shortPage.goto("https://www.amazon.in", {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        // ✅ use browser fetch instead of navigation
        const responseText = await shortPage.evaluate(async (url) => {
            const res = await fetch(url, {
                method: "GET",
                credentials: "include",
                headers: {
                    accept: "application/json, text/javascript, */*; q=0.01",
                    "x-requested-with": "XMLHttpRequest"
                }
            });

            return await res.text();
        }, shortApi);

        // ✅ HTML response means SiteStripe auth unavailable
        if (responseText.trim().toLowerCase().startsWith('<!doctype html')) {
            const result = {
                affiliate_link: longUrl,
                longurl: longUrl
            };

            shortLinkCache.set(longUrl, result);
            return result;
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            const result = {
                affiliate_link: longUrl,
                longurl: longUrl
            };

            shortLinkCache.set(longUrl, result);
            return result;
        }

        // ✅ success short URL
        if (data?.ok && data?.shortUrl) {
            const result = {
                affiliate_link: data.shortUrl,
                longurl: longUrl
            };

            shortLinkCache.set(longUrl, result);
            return result;
        }

        // ✅ fallback
        const result = {
            affiliate_link: longUrl,
            longurl: longUrl
        };

        shortLinkCache.set(longUrl, result);
        return result;

    } catch (error) {
        console.log("Short URL failed:", error.message);

        const result = {
            affiliate_link: longUrl,
            longurl: longUrl
        };

        shortLinkCache.set(longUrl, result);
        return result;

    } finally {
        if (shortPage) {
            await shortPage.close();
        }
    }
}










async function fetchProductDetails(browser, mainPage, url) {
    let detailPage;
    try {
        console.log(`Fetching product details for: ${url}`);
        detailPage = await browser.newPage();
        await detailPage.setUserAgent(userAgents[0]);

        // Copy cookies if present
        const cookies = await mainPage.cookies();
        if (cookies.length) {
            await detailPage.setCookie(...cookies);
        }

        await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const details = await detailPage.evaluate(() => {
            const priceWhole = document.querySelector('span.a-price-whole, .a-price .a-offscreen, #corePrice_feature_div .a-price-whole')?.textContent.replace(/[^\d.]/g, '').trim();
            const strikePrice = document.querySelector('span.a-text-strike, span[data-a-strike="true"], .a-text-price .a-offscreen')?.textContent.replace(/[^\d.]/g, '').trim();
            const discount = document.querySelector('.savingPriceOverride, .base-price-percentage, span[class*="savingsPercentage"]')?.textContent.trim();

            return {
                price_after_discount: priceWhole ? `₹${priceWhole}` : 'N/A',
                price_original: strikePrice ? `₹${strikePrice}` : 'N/A',
                discount: discount || '50%+'
            };
        });
        return details;
    } catch (error) {
        console.error(`Error fetching product details for ${url}:`, error.message);
        return { price_after_discount: 'N/A', price_original: 'N/A', discount: '50%+' };
    } finally {
        if (detailPage) {
            await detailPage.close();
        }
    }
}


async function scrapeCategory(page, category) {
    try {
        console.log(`Scraping Amazon category: ${category.name}`);
        try {
            await page.setViewport({ width: 1280, height: 2000 });
            console.log(`Navigating to: ${category.url}`);
            await page.goto(category.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

            await page.waitForSelector(
                '[data-testid="deal-card"], div[data-deal-id], [class*="DealGridItem-module"]',
                { timeout: 30000 }
            ).catch(() => console.log('Wait timeout, continuing...'));

            await autoScroll(page);
            await new Promise(resolve => setTimeout(resolve, 10000));
            await autoScroll(page);
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log("Current page URL:", await page.url());

            await page.screenshot({ path: 'amazon_deals_screenshot.png' });
        } catch (e) {
            console.log(`Navigation error: ${e.message}`);
        }

        const dealElements = await page.$$(
            '[data-testid="deal-card"], \
            div[data-deal-id], \
            .DealGridItem-module__dealItem, \
            .DealContent-module__dealCard, \
            [class*="DealGridItem-module"], \
            [class*="ProductCard-module"]'
        );
        console.log(`Found ${dealElements.length} potential deal cards in ${category.name}`);

        const deals = [];
        for (const element of dealElements) {
            const dealData = await page.evaluate((el) => {
                const titleElement = el.querySelector('span#dealTitle, span[class*="a-truncate-full"], p[class*="ProductCard-module__title"], .a-size-base');
                const title = titleElement ? titleElement.textContent.trim() : '';

                const urlElement = el.querySelector('a.a-link-normal');
                const rawUrl = urlElement ? urlElement.href : '';

                const imageElement = el.querySelector('img');
                const TELIMG = imageElement ? imageElement.src : '';
                const imageUrl =
                    (imageElement?.closest('picture')?.querySelector('source[srcset*=" 2x"]')?.getAttribute('srcset')?.match(/(.+?)\s2x/)?.[1]
                        || imageElement?.srcset?.match(/(.+?)\s2x/)?.[1]
                        || imageElement?.src || '').trim();

                const asinMatch = rawUrl.match(/\/dp\/([A-Z0-9]{10})/) || rawUrl.match(/\/deal\/([A-Z0-9]{10})/) || rawUrl.match(/\/product\/([A-Z0-9]{10})/);
                const asin = asinMatch ? asinMatch[1] : null;

                // Extract prices cleanly off the deal card
                let price_after_discount = 'N/A';
                const wholePriceEl = el.querySelector('.a-price-whole');
                if (wholePriceEl) {
                    const cleanNum = wholePriceEl.textContent.replace(/[^0-9]/g, '');
                    if (cleanNum) price_after_discount = `₹${parseInt(cleanNum, 10).toLocaleString('en-IN')}`;
                } else {
                    const offscreenDeal = el.querySelector('.a-price .a-offscreen, [class*="priceToPay"] .a-offscreen');
                    if (offscreenDeal) {
                        const match = offscreenDeal.textContent.match(/\d+(?:,\d+)*/);
                        if (match) price_after_discount = `₹${match[0]}`;
                    }
                }

                let price_original = 'N/A';
                const offscreenStrike = el.querySelector('.a-text-price .a-offscreen, span[data-a-strike="true"] .a-offscreen');
                if (offscreenStrike) {
                    const match = offscreenStrike.textContent.match(/\d+(?:,\d+)*/);
                    if (match) price_original = `₹${match[0]}`;
                } else {
                    const strikeEl = el.querySelector('.a-text-strike, span[data-a-strike="true"]');
                    if (strikeEl) {
                        const cleanNum = strikeEl.textContent.replace(/[^0-9]/g, '');
                        if (cleanNum) price_original = `₹${parseInt(cleanNum, 10).toLocaleString('en-IN')}`;
                    }
                }

                let discount = '50%+';
                const discountEl = el.querySelector('.a-badge-text, .a-size-mini, [class*="style_filledRoundedBadgeLabel"] span, [class*="BadgeLabel"]');
                if (discountEl && discountEl.textContent.trim()) {
                    discount = discountEl.textContent.trim();
                }

                return { title, rawUrl, asin, imageUrl, TELIMG, price_after_discount, price_original, discount };
            }, element);

            if (dealData.asin && dealData.title) {
                let discount = dealData.discount || '50%+';
                let price_after_discount = dealData.price_after_discount;
                let price_original = dealData.price_original;

                // Only fetch details from product page if deal price could not be extracted from card
                // This prevents opening 100+ tabs which would trigger Amazon CAPTCHAs/rate limits
                if (price_after_discount === 'N/A') {
                    const cleanUrl = `https://www.amazon.in/dp/${dealData.asin}?tag=${AMAZON_AFFILIATE_TAG}`;
                    const details = await fetchProductDetails(page.browser(), page, cleanUrl);
                    if (details.price_after_discount && details.price_after_discount !== 'N/A') {
                        price_after_discount = details.price_after_discount;
                    }
                    if (details.price_original && details.price_original !== 'N/A') {
                        price_original = details.price_original;
                    }
                    if (details.discount && details.discount !== '50%+') {
                        discount = details.discount;
                    }
                }

                // Compute savings if both prices are numeric
                let savings = 'Great Deal';
                const numDeal = parseInt((price_after_discount || '').replace(/[^\d]/g, ''));
                const numOrig = parseInt((price_original || '').replace(/[^\d]/g, ''));
                if (!isNaN(numDeal) && !isNaN(numOrig) && numOrig > numDeal) {
                    savings = `Save ₹${(numOrig - numDeal).toLocaleString('en-IN')}`;
                } else if (!isNaN(numDeal) && !isNaN(parseInt(discount))) {
                    // Estimate original price from discount if strike price was missing
                    const discPct = parseInt(discount);
                    if (discPct > 0 && discPct < 100) {
                        const estimatedOrig = Math.round(numDeal / (1 - (discPct / 100)));
                        price_original = `₹${estimatedOrig.toLocaleString('en-IN')}`;
                        savings = `Save ₹${(estimatedOrig - numDeal).toLocaleString('en-IN')}`;
                    }
                }

                const cleanUrl = `https://www.amazon.in/dp/${dealData.asin}?tag=${AMAZON_AFFILIATE_TAG}`;
                const shortLinkData = await getAmazonShortUrl(page.browser(), page, cleanUrl);

                deals.push({
                    asin: dealData.asin,
                    title: dealData.title,
                    discount: discount,
                    price_original: price_original,
                    price_after_discount: price_after_discount,
                    savings: savings,
                    imageUrl: dealData.imageUrl,
                    TELIMG: dealData.TELIMG,
                    affiliate_link: shortLinkData.affiliate_link,
                    longurl: shortLinkData.longurl,
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
            userDataDir: path.join(__dirname, 'amazon_profile'),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1366,2200',
                '--start-maximized',
                '--lang=en-IN',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
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


        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false
            });

            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32'
            });

            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-IN', 'en']
            });
        });

        await page.setUserAgent(userAgents[0]);
        await page.setViewport({ width: 1280, height: 1280 });

        // ✅ ADD THIS HERE
        await page.goto("https://www.amazon.com", {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

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
        } catch (e) { }

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
