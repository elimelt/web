#!/bin/bash

# Count lines of code YOU have written across all your GitHub repos
# Usage: ./count_my_code.sh [--name "Your Name"] [email1@example.com] [email2@example.com] ...

set -e

# Parse arguments
AUTHOR_NAME=""
AUTHOR_EMAILS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --name)
            AUTHOR_NAME="$2"
            shift 2
            ;;
        *)
            AUTHOR_EMAILS+=("$1")
            shift
            ;;
    esac
done

# Get emails from git config if none provided
if [ ${#AUTHOR_EMAILS[@]} -eq 0 ]; then
    git_email=$(git config user.email)
    if [ -z "$git_email" ]; then
        echo "Error: No email provided and no git user.email configured"
        echo "Usage: $0 [--name \"Your Name\"] [email1@example.com] [email2@example.com] ..."
        exit 1
    fi
    AUTHOR_EMAILS=("$git_email")
fi

# Get name from git config if not provided
if [ -z "$AUTHOR_NAME" ]; then
    AUTHOR_NAME=$(git config user.name 2>/dev/null || echo "")
fi

echo "================================================"
echo "Counting YOUR lines of code across all repos"
if [ -n "$AUTHOR_NAME" ]; then
    echo "Author: $AUTHOR_NAME"
fi
echo "Emails:"
for email in "${AUTHOR_EMAILS[@]}"; do
    echo "  - $email"
done
echo "================================================"
echo

# Create working directory
WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

cd "$WORK_DIR"

# Get all organizations
echo "Fetching organizations..."
gh api user/orgs --jq '.[].login' > orgs.txt 2>/dev/null || touch orgs.txt
ORG_COUNT=$(wc -l < orgs.txt)

if [ "$ORG_COUNT" -gt 0 ]; then
    echo "Found $ORG_COUNT organizations"
fi
echo

# Get all personal repositories
echo "Fetching personal repositories..."
gh repo list --limit 1000 --json nameWithOwner,isFork --jq '.[] | select(.isFork == false) | .nameWithOwner' > all_repos.txt

# Get repositories from organizations
if [ "$ORG_COUNT" -gt 0 ]; then
    echo "Fetching organization repositories..."
    while IFS= read -r org; do
        gh repo list "$org" --limit 1000 --json nameWithOwner,isFork --jq '.[] | select(.isFork == false) | .nameWithOwner' >> all_repos.txt 2>/dev/null || true
    done < orgs.txt
fi

# Remove duplicates
sort -u all_repos.txt -o all_repos.txt

cat all_repos.txt

REPO_COUNT=$(wc -l < all_repos.txt)
echo "Found $REPO_COUNT total repositories"
echo
echo "Analyzing repositories..."
echo

# Initialize counters
TOTAL_ADDED=0
TOTAL_DELETED=0
PROCESSED=0
REPOS_WITH_COMMITS=0
FAILED_REPOS=0

# Create report file
REPORT_FILE="$WORK_DIR/report.txt"
echo "GitHub Lines of Code Report" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
if [ -n "$AUTHOR_NAME" ]; then
    echo "Author: $AUTHOR_NAME" >> "$REPORT_FILE"
fi
echo "Emails:" >> "$REPORT_FILE"
for email in "${AUTHOR_EMAILS[@]}"; do
    echo "  - $email" >> "$REPORT_FILE"
done
echo "" >> "$REPORT_FILE"
echo "Repositories with contributions:" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Process each repository one at a time
while IFS= read -r repo; do
    PROCESSED=$((PROCESSED + 1))
    printf "[%d/%d] %s" "$PROCESSED" "$REPO_COUNT" "$repo"
    
    # Create clean directory for this repo
    REPO_DIR="$WORK_DIR/current_repo"
    rm -rf "$REPO_DIR" 2>/dev/null || true
    mkdir -p "$REPO_DIR"
    cd "$REPO_DIR"
    
    # Clone the repo (shallow) with timeout
    printf " (cloning...)"
    if ! timeout 10 git clone --quiet --depth 1 "git@github.com:$repo" repo >/dev/null 2>&1; then
        FAILED_REPOS=$((FAILED_REPOS + 1))
        printf " FAILED to execute: git clone --quiet --depth 1 \"git@github.com:$repo\" repo\n"
        cd "$WORK_DIR"
        continue
    fi
    
    cd repo
    
    # Quick check: any commits by any of the author emails or name?
    printf " (checking...)"
    has_commits=0
    
    # Try emails first
    for email in "${AUTHOR_EMAILS[@]}"; do
        count=$(timeout 5 git log --all --author="$email" --oneline -1 2>/dev/null | wc -l || echo 0)
        if [ "$count" -gt 0 ]; then
            has_commits=1
            break
        fi
    done
    
    # Try name if provided and no email match
    if [ "$has_commits" -eq 0 ] && [ -n "$AUTHOR_NAME" ]; then
        count=$(timeout 5 git log --all --author="$AUTHOR_NAME" --oneline -1 2>/dev/null | wc -l || echo 0)
        if [ "$count" -gt 0 ]; then
            has_commits=1
        fi
    fi
    
    # Try usernames as fallback
    if [ "$has_commits" -eq 0 ]; then
        for email in "${AUTHOR_EMAILS[@]}"; do
            username=$(echo "$email" | cut -d'@' -f1)
            count=$(timeout 10 git log --all --author="$username" --oneline -1 2>/dev/null | wc -l || echo 0)
            if [ "$count" -gt 0 ]; then
                has_commits=1
                break
            fi
        done
    fi
    
    # Skip if no commits
    if [ "$has_commits" -eq 0 ]; then
        printf " (no commits)\n"
        cd "$WORK_DIR"
        continue
    fi
    
    # Unshallow to get full history with timeout
    printf " (fetching history...)"
    if ! timeout 2 git fetch --unshallow >/dev/null 2>&1; then
        printf " TIMEOUT on fetch\n"
        FAILED_REPOS=$((FAILED_REPOS + 1))
        cd "$WORK_DIR"
        continue
    fi
    
    # Count lines for all emails combined
    printf " (counting...)"
    added=0
    deleted=0
    
    # Count by emails
    for email in "${AUTHOR_EMAILS[@]}"; do
        stats=$(timeout 2 git log --all --author="$email" --pretty=tformat: --numstat 2>/dev/null | \
            awk '{ 
                if ($1 != "-" && $2 != "-") {
                    added += $1; 
                    deleted += $2;
                }
            } END { printf "%d %d", added, deleted }' || echo "0 0")
        
        if [ -n "$stats" ]; then
            read email_added email_deleted <<< "$stats"
            added=$((added + email_added))
            deleted=$((deleted + email_deleted))
        fi
    done
    
    # Count by name if provided
    if [ -n "$AUTHOR_NAME" ]; then
        stats=$(timeout 2 git log --all --author="$AUTHOR_NAME" --pretty=tformat: --numstat 2>/dev/null | \
            awk '{ 
                if ($1 != "-" && $2 != "-") {
                    added += $1; 
                    deleted += $2;
                }
            } END { printf "%d %d", added, deleted }' || echo "0 0")
        
        if [ -n "$stats" ]; then
            read name_added name_deleted <<< "$stats"
            added=$((added + name_added))
            deleted=$((deleted + name_deleted))
        fi
    fi
    
    # Try usernames if no matches yet
    if [ "$added" -eq 0 ] && [ "$deleted" -eq 0 ]; then
        for email in "${AUTHOR_EMAILS[@]}"; do
            username=$(echo "$email" | cut -d'@' -f1)
            stats=$(timeout 2 git log --all --author="$username" --pretty=tformat: --numstat 2>/dev/null | \
                awk '{ 
                    if ($1 != "-" && $2 != "-") {
                        added += $1; 
                        deleted += $2;
                    }
                } END { printf "%d %d", added, deleted }' || echo "0 0")
            
            if [ -n "$stats" ]; then
                read username_added username_deleted <<< "$stats"
                added=$((added + username_added))
                deleted=$((deleted + username_deleted))
            fi
        done
    fi
    
    # Add to totals if we found contributions
    if [ "$added" -gt 0 ] || [ "$deleted" -gt 0 ]; then
        TOTAL_ADDED=$((TOTAL_ADDED + added))
        TOTAL_DELETED=$((TOTAL_DELETED + deleted))
        REPOS_WITH_COMMITS=$((REPOS_WITH_COMMITS + 1))
        
        net=$((added - deleted))
        printf " +%d -%d (net: %d)\n" "$added" "$deleted" "$net"
        echo "$repo: +$added -$deleted (net: $net)" >> "$REPORT_FILE"
    else
        printf " (no lines found)\n"
    fi
    
    cd "$WORK_DIR"
    
done < all_repos.txt

TOTAL_NET=$((TOTAL_ADDED - TOTAL_DELETED))

# Print summary
echo
echo "================================================"
echo "              SUMMARY"
echo "================================================"
echo
printf "Total lines added:    %'d\n" $TOTAL_ADDED
printf "Total lines deleted:  %'d\n" $TOTAL_DELETED
printf "Net lines of code:    %'d\n" $TOTAL_NET
echo
if [ -n "$AUTHOR_NAME" ]; then
    echo "Author: $AUTHOR_NAME"
fi
echo "Emails:"
for email in "${AUTHOR_EMAILS[@]}"; do
    echo "  - $email"
done
echo "Organizations: ${ORG_COUNT}"
echo "Total repositories: ${REPO_COUNT}"
echo "Repos with your commits: ${REPOS_WITH_COMMITS}"
if [ "$FAILED_REPOS" -gt 0 ]; then
    echo "Failed to clone: ${FAILED_REPOS}"
fi
echo "================================================"

# Add summary to report
echo "" >> "$REPORT_FILE"
echo "================================================" >> "$REPORT_FILE"
echo "SUMMARY" >> "$REPORT_FILE"
echo "================================================" >> "$REPORT_FILE"
printf "Total lines added:    %'d\n" $TOTAL_ADDED >> "$REPORT_FILE"
printf "Total lines deleted:  %'d\n" $TOTAL_DELETED >> "$REPORT_FILE"
printf "Net lines of code:    %'d\n" $TOTAL_NET >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Organizations: $ORG_COUNT" >> "$REPORT_FILE"

if [ "$ORG_COUNT" -gt 0 ]; then
    echo "" >> "$REPORT_FILE"
    echo "Organizations:" >> "$REPORT_FILE"
    while IFS= read -r org; do
        echo "  - $org" >> "$REPORT_FILE"
    done < orgs.txt
fi

echo "" >> "$REPORT_FILE"
echo "Total repositories: $REPO_COUNT" >> "$REPORT_FILE"
echo "Repos with your commits: $REPOS_WITH_COMMITS" >> "$REPORT_FILE"
echo "Failed to clone: $FAILED_REPOS" >> "$REPORT_FILE"

# Save to home directory
FINAL_REPORT="$HOME/github_loc_report_$(date +%Y%m%d_%H%M%S).txt"
cp "$REPORT_FILE" "$FINAL_REPORT"

echo
echo "Report saved to: $FINAL_REPORT"