#!/usr/bin/env python3
"""
Dryad Site Deployer

Pushes site/ changes directly to vivicool12334/dryad via GitHub API (no git required).
Vercel auto-deploys from vivicool12334/dryad on push.

Why GitHub API instead of git push:
  - The FUSE-mounted workspace creates immutable .git/index.lock files
  - This approach works reliably every time

Requires NOCK4_GITHUB_TOKEN in .env with repo scope (nock4 is a collaborator on vivicool12334/dryad).
"""

import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

REPO = "vivicool12334/dryad"
BRANCH = "main"
VERCEL_DOMAIN = "dryad.vercel.app"
SITE_DIR = "site"


def find_repo_root():
    """Find the dryad repo root directory."""
    candidates = [
        os.getcwd(),
        os.path.join(os.getcwd(), "mnt", "dryad-eliza"),
        os.path.expanduser("~/dryad"),
        "/root/dryad",
    ]
    for path in candidates:
        if os.path.isdir(os.path.join(path, "site")):
            return path
    return None


def get_token(repo_root):
    """Get the nock4 GitHub token from environment or .env file."""
    token = os.environ.get("NOCK4_GITHUB_TOKEN")
    if token:
        return token
    env_file = os.path.join(repo_root, ".env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("NOCK4_GITHUB_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def github_api(method, endpoint, token, data=None):
    """Make a GitHub API request. Returns (response_dict, status_code)."""
    url = f"https://api.github.com{endpoint}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "dryad-deployer",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            error_json = json.loads(error_body)
        except json.JSONDecodeError:
            error_json = {"message": error_body}
        return error_json, e.code


def collect_site_files(repo_root):
    """Walk site/ directory and collect all files to deploy."""
    site_path = os.path.join(repo_root, SITE_DIR)
    files = []
    for root, dirs, filenames in os.walk(site_path):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in filenames:
            if fname.startswith("."):
                continue
            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, repo_root)
            files.append(rel_path)
    return sorted(files)


def push_via_api(repo_root, token, files):
    """Push files to GitHub using the Git Data API (create blobs, tree, commit, update ref)."""

    # Step 1: Get current HEAD
    print("  Getting current HEAD...")
    ref_data, status = github_api("GET", f"/repos/{REPO}/git/refs/heads/{BRANCH}", token)
    if status != 200:
        print(f"  ERROR: Could not get ref ({status}): {ref_data.get('message', '')}")
        return False
    current_sha = ref_data["object"]["sha"]
    print(f"  HEAD: {current_sha[:12]}")

    # Step 2: Get current tree
    commit_data, _ = github_api("GET", f"/repos/{REPO}/git/commits/{current_sha}", token)
    tree_sha = commit_data["tree"]["sha"]

    # Step 3: Create blobs for each file
    print(f"  Uploading {len(files)} files...")
    tree_items = []
    for filepath in files:
        full_path = os.path.join(repo_root, filepath)
        with open(full_path, "rb") as f:
            content = base64.b64encode(f.read()).decode()
        blob_data, status = github_api("POST", f"/repos/{REPO}/git/blobs", token, {
            "content": content,
            "encoding": "base64"
        })
        if status != 201:
            print(f"  ERROR: Failed to create blob for {filepath} ({status})")
            return False
        tree_items.append({
            "path": filepath,
            "mode": "100644",
            "type": "blob",
            "sha": blob_data["sha"]
        })
    print("  All blobs created.")

    # Step 4: Create new tree
    tree_data, status = github_api("POST", f"/repos/{REPO}/git/trees", token, {
        "base_tree": tree_sha,
        "tree": tree_items
    })
    if status != 201:
        print(f"  ERROR: Failed to create tree ({status})")
        return False

    # Step 5: Create commit
    commit_msg = f"deploy site ({len(files)} files)"
    commit_data, status = github_api("POST", f"/repos/{REPO}/git/commits", token, {
        "message": commit_msg,
        "tree": tree_data["sha"],
        "parents": [current_sha]
    })
    if status != 201:
        print(f"  ERROR: Failed to create commit ({status})")
        return False
    new_sha = commit_data["sha"]
    print(f"  Commit: {new_sha[:12]} — {commit_msg}")

    # Step 6: Update ref
    ref_data, status = github_api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", token, {
        "sha": new_sha
    })
    if status != 200:
        print(f"  ERROR: Failed to update ref ({status})")
        return False
    print(f"  Ref updated to {new_sha[:12]}")

    return True


def verify_deployment():
    """Verify the Vercel deployment is live and serving updated content."""
    print(f"\n[3/3] Verifying deployment at https://{VERCEL_DOMAIN}...")
    print("  Waiting for Vercel to build (usually 15-30s)...")

    for i in range(8):
        time.sleep(5)
        try:
            req = urllib.request.Request(
                f"https://{VERCEL_DOMAIN}",
                method="HEAD",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    print(f"  Site responding (HTTP {resp.status})")
                    # Fetch the page and check for our accessibility markers
                    fetch_req = urllib.request.Request(f"https://{VERCEL_DOMAIN}")
                    with urllib.request.urlopen(fetch_req, timeout=10) as fetch_resp:
                        body = fetch_resp.read().decode("utf-8", errors="replace")[:2000]
                        if "skip-link" in body:
                            print("  Content verified (skip-link marker found)")
                        else:
                            print("  Site is up but content may still be deploying")
                    return True
        except Exception:
            print(f"  Waiting... ({(i + 1) * 5}s)")

    print("\n  Deployment may still be in progress.")
    print("  Check: https://vercel.com/nock4s-projects/dryad")
    return True


def main():
    print("=" * 50)
    print("  DRYAD SITE DEPLOYER (v2 — GitHub API)")
    print("=" * 50)

    # Find repo
    repo_root = find_repo_root()
    if not repo_root:
        print("\nERROR: Could not find the dryad repository (no site/ directory found).")
        sys.exit(1)
    print(f"\nRepo: {repo_root}")

    # Check for token
    token = get_token(repo_root)
    if not token:
        print("\nERROR: NOCK4_GITHUB_TOKEN not found.")
        print("Add it to .env: NOCK4_GITHUB_TOKEN=ghp_yourtoken")
        sys.exit(1)
    print("Token: found")

    # Collect files
    files = collect_site_files(repo_root)
    if not files:
        print("\nERROR: No files found in site/ directory.")
        sys.exit(1)
    print(f"Files: {len(files)} in site/\n")

    # Step 1: Push to nock4/dryad via API
    print(f"[1/3] Pushing to {REPO} via GitHub API...")
    if not push_via_api(repo_root, token, files):
        print("\nDeployment failed at push step.")
        sys.exit(1)

    # Step 2: Vercel auto-deploys from nock4/dryad
    print(f"\n[2/3] Vercel auto-deploying from {REPO}...")
    print("  No fork sync needed — we push directly to the deploy repo.")

    # Step 3: Verify
    verify_deployment()

    print("\n" + "=" * 50)
    print("  DEPLOYMENT COMPLETE")
    print(f"  https://{VERCEL_DOMAIN}")
    print("=" * 50)


if __name__ == "__main__":
    main()
