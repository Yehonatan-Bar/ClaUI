#!/usr/bin/env bash
# =============================================================================
# Particle Accelerator Security Demo
# Tests secret redaction across all 14 detection rules + env-value scanning
# ALL SECRETS IN THIS FILE ARE FAKE / NON-FUNCTIONAL
# =============================================================================

echo "========================================"
echo "  PARTICLE ACCELERATOR SECURITY DEMO"
echo "  Testing Secret Redaction Capabilities"
echo "========================================"
echo ""

# ---------- 1. GitHub Classic PAT ----------
echo "[1/14] GitHub Classic PAT"
echo "  Cloning with token: ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
echo ""

# ---------- 2. GitHub Fine-Grained PAT ----------
echo "[2/14] GitHub Fine-Grained PAT"
echo "  Auth header: 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"
echo ""

# ---------- 3. AWS Access Key ----------
echo "[3/14] AWS Access Key"
echo "  AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
echo ""

# ---------- 4. JWT Token ----------
echo "[4/14] JWT Token"
echo "  Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
echo ""

# ---------- 5. OpenAI API Key ----------
echo "[5/14] OpenAI API Key"
echo "  OPENAI_API_KEY=sk-proj1234567890abcdefghijklmnopqrstuvwxyz"
echo ""

# ---------- 6. Anthropic API Key ----------
echo "[6/14] Anthropic API Key"
echo "  ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890"
echo ""

# ---------- 7. Slack Token ----------
echo "[7/14] Slack Bot Token"
echo "  SLACK_BOT_TOKEN=xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuv"
echo ""

# ---------- 8. Stripe Secret Key ----------
echo "[8/14] Stripe Secret Key"
echo "  STRIPE_SECRET=sk_test_4eC39HqLyjWDarjtT1zdp7dc0123456789abcdef"
echo ""

# ---------- 9. Google API Key ----------
echo "[9/14] Google API Key"
echo "  GOOGLE_MAPS_KEY=AIzaSyDfakekey12345678901234567890123456"
echo ""

# ---------- 10. Private Key (PEM) ----------
echo "[10/14] Private Key Block"
echo "  Found in config:"
echo "-----BEGIN RSA PRIVATE KEY-----"
echo "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGcY5unA67hqxnfZmQgHHEaN"
echo "FakeKeyDataNotRealNotRealNotRealNotRealNotRealNotRealNotRealNotReal"
echo "MoreFakeDataHereJustForDemoMoreFakeDataHereJustForDemoFakeDataHere"
echo "-----END RSA PRIVATE KEY-----"
echo ""

# ---------- 11. Basic Auth URL ----------
echo "[11/14] Basic Auth URL"
echo "  Connecting to: https://admin:SuperSecret123@api.example.com/v2/data"
echo ""

# ---------- 12. Database URL with Credentials ----------
echo "[12/14] Database URL Credentials"
echo "  DATABASE_URL=postgres://dbuser:p4ssw0rd_s3cret@db.example.com:5432/mydb"
echo "  REDIS_URL=redis://cache_user:r3d1s_p4ss@redis.example.com:6379/0"
echo ""

# ---------- 13. Bearer Token ----------
echo "[13/14] Bearer Token"
echo "  curl -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiZGVtbyJ9.fakesignature1234567890'"
echo ""

# ---------- 14. Multiple secrets in one line ----------
echo "[14/14] Mixed Secrets (multiple per line)"
echo "  Config dump: token=ghp_x1Y2z3A4b5C6d7E8f9G0h1I2j3K4l5M6n7O8 stripe=sk_live_51HxG2aBcDeFgHiJkLmNoPqRsTuVwXyZ01234"
echo ""

echo "========================================"
echo "  DEMO COMPLETE"
echo "  Total: 14 secret types tested"
echo "  + 2 database URLs with credentials"
echo "  + 1 mixed-secrets line"
echo "========================================"
