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

POST_LIMIT_PER_RUN = 2
SLEEP_BETWEEN_POSTS = 2
# =========================================


def extract_discount_value(discount_str):
    """Extract numeric discount value from text"""
    try:
        nums = ''.join(filter(str.isdigit, discount_str))
        return int(nums) if nums else 0
    except:
        return 0


def download_image(url, filename="temp_tele.jpg"):
    """Download image locally so Telegram always accepts it"""
    if not url:
        return None
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 200 and "image" in r.headers.get("Content-Type", ""):
            with open(filename, "wb") as f:
                f.write(r.content)
            return filename
    except:
        pass
    return None


def post_to_telegram():
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("❌ Telegram credentials not configured.")
        return

    if not os.path.exists(NEW_DEALS_FILE):
        print("❌ new_deals.json not found.")
        return

    # Load deals
    try:
        with open(NEW_DEALS_FILE, "r") as f:
            all_deals = json.load(f)
    except Exception as e:
        print(f"❌ Error loading deals: {e}")
        return

    # Load history
    last_posted = []
    if os.path.exists(LAST_POSTED_FILE):
        try:
            with open(LAST_POSTED_FILE, "r") as f:
                last_posted = json.load(f)
        except:
            last_posted = []

    # Filter unposted deals
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

        posted = False

        # ✅ Use TELIMG only
        telimg_url = deal.get("TELIMG")
        if telimg_url:
            telimg_url = telimg_url.split("?")[0]  # remove tracking params

        image_path = download_image(telimg_url)

        # Try image upload
        if image_path:
            try:
                with open(image_path, "rb") as img:
                    response = requests.post(
                        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto",
                        files={"photo": img},
                        data={
                            "chat_id": TELEGRAM_CHAT_ID,
                            "caption": message
                        },
                        timeout=20
                    )

                if response.status_code == 200:
                    posted = True
                else:
                    print("⚠️ Image upload failed, sending text")

            except Exception as e:
                print(f"⚠️ Image exception: {e}")

            finally:
                if os.path.exists(image_path):
                    os.remove(image_path)

        # Fallback to text
        if not posted:
            response = requests.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                data={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": message
                },
                timeout=15
            )
            if response.status_code == 200:
                posted = True

        if posted:
            print(f"✅ Posted ASIN: {deal.get('asin')}")
            last_posted.append(deal.get("link"))
        else:
            print(f"❌ Failed to post ASIN: {deal.get('asin')}")

        time.sleep(SLEEP_BETWEEN_POSTS)

    # Save history
    with open(LAST_POSTED_FILE, "w") as f:
        json.dump(last_posted, f, indent=4)

    print("✅ Telegram posting cycle completed.")


if __name__ == "__main__":
    post_to_telegram()
