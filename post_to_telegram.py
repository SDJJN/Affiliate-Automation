import json
import os
import requests
import time
from dotenv import load_dotenv

load_dotenv()

# ================= CONFIG =================
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHANNEL_ID")

NEW_DEALS_FILE = "new_deals.json"
LAST_POSTED_FILE = "last_posted_tele.json"

POST_LIMIT_PER_RUN = 2   # 👈 only 2 posts every 15 min
SLEEP_BETWEEN_POSTS = 2  # seconds
# ==========================================


def extract_discount_value(discount_str):
    """
    Extracts numeric discount value from strings like:
    '65%', 'Up to 70 %', '₹2,000 off'
    """
    try:
        numbers = ''.join(filter(str.isdigit, discount_str))
        return int(numbers) if numbers else 0
    except:
        return 0


def post_to_telegram():
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("❌ Telegram credentials not configured.")
        return

    if not os.path.exists(NEW_DEALS_FILE):
        print("❌ new_deals.json not found.")
        return

    # Load all deals
    try:
        with open(NEW_DEALS_FILE, "r") as f:
            all_deals = json.load(f)
    except Exception as e:
        print(f"❌ Error reading new_deals.json: {e}")
        return

    # Load posting history
    last_posted = []
    if os.path.exists(LAST_POSTED_FILE):
        try:
            with open(LAST_POSTED_FILE, "r") as f:
                last_posted = json.load(f)
        except:
            last_posted = []

    # Filter already posted deals
    available_deals = [
        d for d in all_deals
        if d.get("link") not in last_posted
    ]

    if not available_deals:
        print("ℹ️ No new unique deals left.")
        return

    # Sort by highest discount
    available_deals.sort(
        key=lambda d: extract_discount_value(d.get("discount", "")),
        reverse=True
    )

    # Pick only top N deals
    deals_to_post = available_deals[:POST_LIMIT_PER_RUN]

    print(f"🚀 Posting {len(deals_to_post)} highest discount deals...")

    for deal in deals_to_post:
        message = (
            f"🔥 {deal.get('title', 'Hot Deal')}\n\n"
            f"💰 Discount: {deal.get('discount', 'N/A')}\n"
            f"👉 Buy Now: {deal.get('affiliate_link', deal.get('link'))}\n\n"
            "As an Amazon Associate, I earn from qualifying purchases.\n"
            "#AmazonDeals #BestDeals #ShopNow"
        )

        try:
            if deal.get("imageUrl"):
                url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto"
                payload = {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "photo": deal["imageUrl"],
                    "caption": message
                }
            else:
                url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
                payload = {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": message
                }

            response = requests.post(url, data=payload, timeout=15)

            if response.status_code == 200:
                print(f"✅ Posted ASIN: {deal.get('asin')}")
                last_posted.append(deal.get("link"))
            else:
                print(f"❌ Telegram error: {response.text}")

            time.sleep(SLEEP_BETWEEN_POSTS)

        except Exception as e:
            print(f"❌ Exception posting deal: {e}")

    # Save updated history
    with open(LAST_POSTED_FILE, "w") as f:
        json.dump(last_posted, f, indent=4)

    print("✅ Telegram posting cycle completed.")


if __name__ == "__main__":
    post_to_telegram()
