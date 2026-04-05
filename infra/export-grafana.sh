#!/bin/bash
set -e

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
OUTPUT_DIR="${1:-./grafana-export}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "Grafana Export Tool"
echo "==================="
echo ""
echo "Grafana URL: $GRAFANA_URL"
echo "Output directory: $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR/datasources"
mkdir -p "$OUTPUT_DIR/dashboards"

echo "Exporting datasources..."

DATASOURCES=$(docker exec grafana curl -s "$GRAFANA_URL/api/datasources" 2>/dev/null)

if [ -z "$DATASOURCES" ] || [ "$DATASOURCES" = "null" ]; then
    echo "Warning: No datasources found or unable to connect to Grafana"
else
    echo "$DATASOURCES" | jq -c '.[]' | while read -r datasource; do
        NAME=$(echo "$datasource" | jq -r '.name')
        DS_UID=$(echo "$datasource" | jq -r '.uid')

        SAFE_NAME=$(echo "$NAME" | tr '/' '_' | tr ' ' '_')

        echo "$datasource" | jq '.' > "$OUTPUT_DIR/datasources/${SAFE_NAME}.json"
        echo "  Exported: $NAME"
    done
fi

echo ""
echo "Exporting dashboards..."

DASHBOARDS=$(docker exec grafana curl -s "$GRAFANA_URL/api/search?type=dash-db" 2>/dev/null)

if [ -z "$DASHBOARDS" ] || [ "$DASHBOARDS" = "null" ]; then
    echo "Warning: No dashboards found or unable to connect to Grafana"
else
    echo "$DASHBOARDS" | jq -c '.[]' | while read -r dashboard; do
        DASH_UID=$(echo "$dashboard" | jq -r '.uid')
        TITLE=$(echo "$dashboard" | jq -r '.title')

        if [ "$DASH_UID" != "null" ] && [ -n "$DASH_UID" ]; then
            SAFE_TITLE=$(echo "$TITLE" | tr '/' '_' | tr ' ' '_')

            DASHBOARD_JSON=$(docker exec grafana curl -s "$GRAFANA_URL/api/dashboards/uid/$DASH_UID" 2>/dev/null)

            echo "$DASHBOARD_JSON" | jq '.dashboard' > "$OUTPUT_DIR/dashboards/${SAFE_TITLE}.json"
            echo "  Exported: $TITLE"
        fi
    done
fi

echo ""
echo "Creating backup archive..."
tar -czf "grafana-backup-${TIMESTAMP}.tar.gz" -C "$OUTPUT_DIR" .

echo ""
echo "Export complete!"
echo "  Datasources: $OUTPUT_DIR/datasources/"
echo "  Dashboards: $OUTPUT_DIR/dashboards/"
echo "  Archive: grafana-backup-${TIMESTAMP}.tar.gz"
echo ""
echo "To restore, copy files to:"
echo "  Datasources: ./grafana/datasources/"
echo "  Dashboards: ./grafana/dashboards/"
echo "  Then restart Grafana: docker-compose restart grafana"

