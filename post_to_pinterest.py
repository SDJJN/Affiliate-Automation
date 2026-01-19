import json
import os
import requests
import random
from dotenv import load_dotenv

load_dotenv()

# Configuration
PINTEREST_TOKEN = os.getenv("PINTEREST_ACCESS_TOKEN")
BOARD_ID = os.getenv("PINTEREST_BOARD_ID")
NEW_DEALS_FILE = "new_deals.json"
LAST_POSTED_FILE = "last_posted.json"

def post_to_pinterest():
    if not PINTEREST_TOKEN or not BOARD_ID:
        print("Pinterest Access Token or Board ID not configured.")
        return

    if not os.path.exists(NEW_DEALS_FILE):
        print("No new deals to post.")
        return

    with open(NEW_DEALS_FILE, "r") as f:
        try:
            all_new_deals = json.load(f)
        except:
            print("Error reading new_deals.json")
            return

    if not all_new_deals:
        print("No new deals in the list for Pinterest.")
        return

    # Pick ONE random deal
    deal = random.choice(all_new_deals)
    print(f"Selected deal: {deal['asin']} for Pinterest")

    last_posted = []
    if os.path.exists(LAST_POSTED_FILE):
        try:
            with open(LAST_POSTED_FILE, "r") as f:
                last_posted = json.load(f)
        except:
            last_posted = []

    # Pinterest API v5: Create Pin
    url = "https://api.pinterest.com/v5/pins"
    
    headers = {
        "Authorization": f"Bearer {PINTEREST_TOKEN}",
        "Content-Type": "application/json"
    }
    
    # Message for pin description
    description = f"🔥 {deal['title']}\n\n💰 Discount: {deal['discount']}\n👉 Grab it here: {deal['affiliate_link']}\n\nAs an Amazon Associate, I earn from qualifying purchases. #AmazonDeals #ShopNow #Affiliate"

    payload = {
        "board_id": BOARD_ID,
        "title": deal['title'][:100], # Max 100 chars
        "description": description[:500], # Max 500 chars
        "link": deal['affiliate_link'],
        "media_source": {
            "source_type": "image_url",
            "url": deal['imageUrl']
        }
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 201:
            data = response.json()
            print(f"Successfully posted Pin for {deal['asin']} -> {data.get('id')}")
            
            # Add to history
            last_posted.append(deal['link'])
            
            # Remove from new_deals
            all_new_deals = [d for d in all_new_deals if d['asin'] != deal['asin']]

            # Save history and updated list
            with open(LAST_POSTED_FILE, "w") as f:
                json.dump(last_posted, f, indent=4)
            
            with open(NEW_DEALS_FILE, "w") as f:
                json.dump(all_new_deals, f, indent=4)
        else:
            print(f"Error posting Pin: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"Exception during Pinterest post: {e}")

if __name__ == "__main__":
    post_to_pinterest()
