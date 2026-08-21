# Static Files

This directory contains static files served at static.elimelt.com

- `tracked/` - Version controlled files
- `untracked/` - Large files not in git (gitignored)

Both directories are served from the root. Files are served with the path structure preserved:
- `static/tracked/foo.png` → `https://static.elimelt.com/tracked/foo.png`
- `static/untracked/large.zip` → `https://static.elimelt.com/untracked/large.zip`
