"""Creates the read-only viewer account that recruiters sign in with, once the API is up."""

import os
import sys
import time

import httpx

API = "http://127.0.0.1:7860"


def wait_for_api() -> bool:
    for _ in range(300):
        try:
            if httpx.get(f"{API}/health", timeout=2).status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(1)
    return False


def main() -> int:
    if not wait_for_api():
        print("demo-user: API never became healthy", file=sys.stderr)
        return 1
    login = httpx.post(
        f"{API}/api/v1/auth/login",
        json={"email": os.environ["FIRST_ADMIN_EMAIL"], "password": os.environ["FIRST_ADMIN_PASSWORD"]},
        timeout=10,
    )
    login.raise_for_status()
    email = os.environ["DEMO_EMAIL"]
    resp = httpx.post(
        f"{API}/api/v1/auth/register",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        json={"email": email, "password": os.environ["DEMO_PASSWORD"], "full_name": "Demo Viewer", "role_name": "viewer"},
        timeout=10,
    )
    if resp.status_code == 201:
        print(f"demo-user: created viewer {email}")
    elif resp.status_code in (400, 409):
        print(f"demo-user: {email} already exists")
    else:
        print(f"demo-user: could not create {email}: {resp.status_code} {resp.text}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
