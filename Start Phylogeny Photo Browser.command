#!/bin/zsh

set -u
unsetopt BG_NICE

APP_DIR="${0:A:h}"
APP_URL="http://127.0.0.1:8501/"
STREAMLIT="$APP_DIR/.venv/bin/streamlit"

cd "$APP_DIR" || exit 1

if curl --silent --fail --max-time 1 "$APP_URL/_stcore/health" >/dev/null 2>&1; then
    open "$APP_URL"
    exit 0
fi

if [[ ! -x "$STREAMLIT" ]]; then
    echo "Cannot find the Streamlit environment:"
    echo "$STREAMLIT"
    echo
    echo "Press any key to close this window."
    read -k 1
    exit 1
fi

# Wait for Streamlit to become ready, then open the page once.
(
    for attempt in {1..80}; do
        if curl --silent --fail --max-time 1 "$APP_URL/_stcore/health" >/dev/null 2>&1; then
            open "$APP_URL"
            exit 0
        fi
        sleep 0.25
    done
    echo "Streamlit did not become ready in time."
) &

echo "Starting Phylogeny photo browser..."
echo "Keep this Terminal window open while using the app."
echo "Press Control-C here to stop it."
echo

exec "$STREAMLIT" run "$APP_DIR/app.py" \
    --server.address 127.0.0.1 \
    --server.port 8501 \
    --server.headless true
