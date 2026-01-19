# Amazon Deals Affiliate Automation Bot
Automated Amazon deal extractor and Facebook poster. This bot scrapes high-discount deals from Amazon India and posts them to multiple Facebook pages on a custom schedule.

## Features
- Scrapes deals from reliable sources (DesiDime/DealsMagnet).
- Filters for 50%+ discounts.
- Checks if the deal is from today.
- Automatically posts to Facebook via GitHub Actions.

## Setup
1. Clone the repository.
2. Install dependencies: `pip install -r requirements.txt`.
3. Configure GitHub Secrets:
   - `AMAZON_TAG`: Your Amazon affiliate tag.
   - `POSTING_TOKEN`: Facebook Page Access Token.
   - `POSTING_TARGET_ID`: Facebook Page ID.
