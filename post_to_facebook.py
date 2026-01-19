import facebook
import json
import os
import sys
import random
import time
from dotenv import load_dotenv
import argparse

load_dotenv()

# Configuration
FACEBOOK_TOKEN = os.getenv("POSTING_TOKEN")
NEW_DEALS_FILE = "new_deals.json"
LAST_POSTED_FILE = "last_posted.json"

def post_to_facebook(target_page_id):
    if not FACEBOOK_TOKEN:
        print("Facebook token not configured.")
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
        print(f"No new deals in the list for page {target_page_id}.")
        return

    # Pick ONE random deal
    deal = random.choice(all_new_deals)
    print(f"Selected deal: {deal['asin']} for page {target_page_id}")

    last_posted = []
    if os.path.exists(LAST_POSTED_FILE):
        try:
            with open(LAST_POSTED_FILE, "r") as f:
                last_posted = json.load(f)
        except:
            last_posted = []

    graph = facebook.GraphAPI(access_token=FACEBOOK_TOKEN)
    
    msg = f"🔥 {deal['title']}\n\n"
    msg += f"💰 Discount: {deal['discount']}\n"
    msg += f"👉 Link: {deal['affiliate_link']}\n\n"
    msg += "As an Amazon Associate, I earn from qualifying purchases. #affiliate\n"
    msg += "#AmazonDeals #BestDeals #Savings #ShopNow"

    try:
        # Post as a Photo for better engagement if image is available
        if deal.get('imageUrl'):
            # 1. Post to Feed
            response = graph.put_object(
                parent_object=target_page_id,
                connection_name="photos",
                url=deal['imageUrl'],
                caption=msg
            )
            print(f"Successfully posted Feed Photo for {deal['asin']} to {target_page_id} -> {response['id']}")

            # 2. Post to Story (Experimental endpoint)
            try:
                story_response = graph.put_object(
                    parent_object=target_page_id,
                    connection_name="photo_stories",
                    url=deal['imageUrl']
                )
                print(f"Successfully posted Story for {deal['asin']} to {target_page_id} -> {story_response.get('id', 'Done')}")
            except Exception as e:
                print(f"Note: Could not post Story for {deal['asin']} (Might require additional permissions): {e}")
        else:
            # Fallback to plain text if no image URL found
            response = graph.put_object(
                parent_object=target_page_id,
                connection_name="feed",
                message=msg
            )
            print(f"Successfully posted Feed Message for {deal['asin']} to {target_page_id} -> {response['id']}")
        
        # Add to history
        last_posted.append(deal['link'])
        
        # Remove from new_deals so it's not posted again today (by this or other pages)
        all_new_deals = [d for d in all_new_deals if d['asin'] != deal['asin']]

        # Save history and updated list
        with open(LAST_POSTED_FILE, "w") as f:
            json.dump(last_posted, f, indent=4)
        
        with open(NEW_DEALS_FILE, "w") as f:
            json.dump(all_new_deals, f, indent=4)
            
    except Exception as e:
        print(f"Error posting deal {deal['asin']} to {target_page_id}: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Post a deal to a Facebook Page')
    parser.add_argument('--page', required=True, help='Facebook Page ID to post to')
    args = parser.parse_args()
    
    post_to_facebook(args.page)
