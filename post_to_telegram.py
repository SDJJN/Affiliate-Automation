import json
import os
import requests
import time
import random
from dotenv import load_dotenv

load_dotenv()

# Configuration
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHANNEL_ID")
NEW_DEALS_FILE = "new_deals.json"
LAST_POSTED_FILE = "last_posted_tele.json"

def post_to_telegram():
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram Bot Token or Chat ID not configured.")
        return

    if not os.path.exists(NEW_DEALS_FILE):
        print("No new deals to post.")
        return

    with open(NEW_DEALS_FILE, "r") as f:
        try:
            all_deals = json.load(f)
        except:
            print("Error reading new_deals.json")
            return

    # Load history
    last_posted = []
    if os.path.exists(LAST_POSTED_FILE):
        try:
            with open(LAST_POSTED_FILE, "r") as f:
                last_posted = json.load(f)
        except:
            last_posted = []

    # Filter out already posted deals
    available_deals = [d for d in all_deals if d['link'] not in last_posted]

    if not available_deals:
        print("No new unique deals left for Telegram.")
        return

    print(f"Starting Telegram broadcast of {len(available_deals)} deals...")

    # Post ALL available deals
    for deal in available_deals:
        msg = f"🔥 {deal['title']}\n\n"
        msg += f"💰 Discount: {deal['discount']}\n"
        msg += f"👉 Link: {deal['affiliate_link']}\n\n"
        msg += "As an Amazon Associate, I earn from qualifying purchases. #affiliate\n"
        msg += "#AmazonDeals #TelegramDeals #ShopNow"

        try:
            if deal.get('imageUrl'):
                url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto"
                payload = {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "photo": deal['imageUrl'],
                    "caption": msg
                }
            else:
                url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
                payload = {
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": msg
                }

            response = requests.post(url, data=payload)
            if response.status_code == 200:
                print(f"Successfully posted {deal['asin']} to Telegram.")
                last_posted.append(deal['link'])
            else:
                print(f"Error posting {deal['asin']}: {response.text}")
            
            time.sleep(2) 

        except Exception as e:
            print(f"Exception posting {deal['asin']}: {e}")

    # Save history
    with open(LAST_POSTED_FILE, "w") as f:
        json.dump(last_posted, f, indent=4)
    
    # Note: WE DO NOT CLEAR new_deals.json ANYMORE to allow other platforms to post

if __name__ == "__main__":
    post_to_telegram()
