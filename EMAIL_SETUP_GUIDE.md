# Email Setup Guide - Fix Gmail Authentication Issues

## Current Issue
You're getting: `Error: Invalid login: 535-5.7.8 Username and Password not accepted`

This means Gmail is rejecting your credentials. Here are the solutions:

---

## Solution 1: Use Gmail App Password (Recommended)

### Step-by-Step Instructions:

#### 1. Enable 2-Step Verification
1. Go to your Google Account: https://myaccount.google.com
2. Click on **Security** (left sidebar)
3. Under "How you sign in to Google", click **2-Step Verification**
4. Click **Get Started** and follow the setup process
5. Complete the 2-Step Verification setup

#### 2. Generate App Password
1. After enabling 2-Step Verification, go back to **Security**
2. Under "How you sign in to Google", click **App passwords**
   - Direct link: https://myaccount.google.com/apppasswords
3. You may need to sign in again
4. In the "Select app" dropdown, choose **Mail**
5. In the "Select device" dropdown, choose **Other (Custom name)**
6. Type: `Ticketing System`
7. Click **Generate**
8. Google will show you a 16-character password like: `abcd efgh ijkl mnop`
9. **Copy this password** (you won't be able to see it again)

#### 3. Update Your .env File
Open your `.env` file and update these lines:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=youractual@gmail.com
EMAIL_PASSWORD=abcdefghijklmnop
```

**Important:**
- Replace `youractual@gmail.com` with your real Gmail address
- Replace `abcdefghijklmnop` with the 16-character app password (remove spaces)
- The app password should be 16 characters with no spaces

#### 4. Restart Your Server
```bash
# Stop your server (Ctrl+C) and restart it
npm run dev
```

#### 5. Test the Email
Try creating a customer with a consultant assigned. Check your server console for success messages.

---

## Solution 2: Use Ethereal Email (For Testing Only)

If you don't want to use Gmail for testing, use Ethereal - a fake SMTP service that captures emails.

### Step-by-Step:

#### 1. Create Ethereal Account
1. Go to https://ethereal.email/create
2. It will instantly create a test account with credentials like:
   ```
   Host: smtp.ethereal.email
   Port: 587
   User:RandomName@ethereal.email
   Pass: RandomPassword123
   ```
3. Copy these credentials

#### 2. Update Your .env File
```env
EMAIL_HOST=smtp.ethereal.email
EMAIL_PORT=587
EMAIL_USER=RandomName@ethereal.email
EMAIL_PASSWORD=RandomPassword123
```

#### 3. Restart Your Server
```bash
npm run dev
```

#### 4. Test Email Sending
Create a customer with consultants assigned.

#### 5. View Sent Emails
1. Go to https://ethereal.email/messages
2. Login with the Ethereal credentials
3. You'll see all emails that were "sent" (they're captured, not actually delivered)

**Pros:**
- No need for real email account
- Perfect for development/testing
- Instant setup, no configuration needed
- View emails in a web interface

**Cons:**
- Emails are not actually delivered
- Only for testing, not production

---

## Solution 3: Use Other Email Providers

### Outlook/Hotmail

```env
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_USER=yourname@outlook.com
EMAIL_PASSWORD=your-password
```

**Note:** Outlook may also require an app password if you have 2FA enabled.

### Yahoo Mail

```env
EMAIL_HOST=smtp.mail.yahoo.com
EMAIL_PORT=587
EMAIL_USER=yourname@yahoo.com
EMAIL_PASSWORD=your-app-password
```

**Note:** Yahoo requires an app password:
1. Go to Yahoo Account Security: https://login.yahoo.com/account/security
2. Generate an app password

### Custom SMTP Server

If you have your own SMTP server:

```env
EMAIL_HOST=mail.yourdomain.com
EMAIL_PORT=587
EMAIL_USER=noreply@yourdomain.com
EMAIL_PASSWORD=your-password
```

---

## Verification Checklist

After updating your `.env` file, verify:

- [ ] `EMAIL_USER` contains your actual email address (no placeholder)
- [ ] `EMAIL_PASSWORD` contains the app password (16 characters for Gmail)
- [ ] No spaces in the app password
- [ ] No quotes around the values in .env
- [ ] Server has been restarted after changing .env
- [ ] .env file is in the project root directory

---

## Testing Your Email Configuration

### Method 1: Create a Test Customer

```javascript
// Use Postman, Thunder Client, or cURL
POST http://localhost:5000/api/customers
Content-Type: application/json

{
  "companyName": "Test Company",
  "contactPerson": "Test Person",
  "email": "test@test.com",
  "password": "test12345",
  "consultants": ["your_consultant_id_here"]
}
```

### Method 2: Test Script

Create a file `test-email.js` in your project root:

```javascript
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const testEmail = async () => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to yourself
      subject: 'Test Email',
      text: 'If you receive this, email is working!',
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
  } catch (error) {
    console.error('❌ Email failed:', error.message);
  }
};

testEmail();
```

Run it:
```bash
node test-email.js
```

---

## Common Errors and Solutions

### Error: "Invalid login: 535-5.7.8"
**Solution:** Use App Password, not regular password (see Solution 1)

### Error: "Username and Password not accepted"
**Solution:**
- Make sure EMAIL_USER and EMAIL_PASSWORD are not placeholders
- Verify you're using the app password, not account password
- Check for typos in email/password

### Error: "Connection timeout"
**Solution:**
- Check your internet connection
- Make sure port 587 is not blocked by firewall
- Try using port 465 with `secure: true`

### Error: "self signed certificate"
**Solution:** Already handled in the code with `rejectUnauthorized: false`

### Error: "Email configuration missing"
**Solution:** Make sure .env file exists and has EMAIL_USER and EMAIL_PASSWORD set

### Error: "EAUTH"
**Solution:** Authentication failed - check credentials again

---

## Example .env File (Correct Format)

```env
# Database & Server
JWT_SECRET=your_actual_strong_secret_key_here
MONGO_URI=mongodb://localhost:27017/ticketing
CLIENT_URL=http://localhost:5000

# Email Configuration - Gmail with App Password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=john.doe@gmail.com
EMAIL_PASSWORD=abcdefghijklmnop

# Alternative: Ethereal (for testing)
# EMAIL_HOST=smtp.ethereal.email
# EMAIL_PORT=587
# EMAIL_USER=random.user@ethereal.email
# EMAIL_PASSWORD=randompassword123
```

**Important Notes:**
- No quotes needed around values
- No spaces in passwords
- App password is 16 lowercase letters (no spaces or dashes)
- Comment out unused configurations with `#`

---

## Production Recommendations

For production, consider using dedicated email services:

### 1. SendGrid
- Free tier: 100 emails/day
- Easy setup
- Good deliverability

```bash
npm install @sendgrid/mail
```

### 2. AWS SES (Simple Email Service)
- Very cheap ($0.10 per 1,000 emails)
- High deliverability
- Requires AWS account

### 3. Mailgun
- Free tier: 5,000 emails/month
- Simple API
- Good for transactional emails

### 4. Postmark
- Specialized in transactional emails
- Excellent deliverability
- $10/month for 10,000 emails

---

## Quick Fix Summary

**If you just want to test quickly:**

1. Go to https://ethereal.email/create
2. Copy the credentials shown
3. Update your `.env`:
   ```env
   EMAIL_HOST=smtp.ethereal.email
   EMAIL_PORT=587
   EMAIL_USER=the-user@ethereal.email
   EMAIL_PASSWORD=the-password-shown
   ```
4. Restart server: `npm run dev`
5. Test by creating a customer
6. View emails at https://ethereal.email/messages

**For real email (Gmail):**

1. Enable 2-Step Verification: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Update `.env` with your Gmail and the 16-char app password
4. Restart server
5. Test

---

## Still Having Issues?

1. **Check server console** for detailed error messages
2. **Verify .env values** - make sure no placeholders remain
3. **Restart server** after any .env changes
4. **Check spam folder** - first emails often go to spam
5. **Try Ethereal first** - rules out email provider issues
6. **Check logs** in the terminal for 📧 and ✅ or ❌ messages

---

## Support Links

- Gmail App Passwords: https://support.google.com/accounts/answer/185833
- Google 2-Step Verification: https://www.google.com/landing/2step/
- Ethereal Email (Testing): https://ethereal.email
- Nodemailer Documentation: https://nodemailer.com

---

**Need Help?**
Check the server console output - it now shows helpful error messages with solutions!
