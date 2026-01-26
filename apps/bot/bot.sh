#!/bin/bash
# Solana Memecoin Bot Manager
# Easy script to start, stop, and manage the bot

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$BOT_DIR/.bot.pid"
LOG_FILE="$BOT_DIR/bot.log"

cd "$BOT_DIR"

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "Bot is already running (PID: $PID)"
            return 1
        else
            echo "Removing stale PID file"
            rm "$PID_FILE"
        fi
    fi

    echo "Starting Solana Memecoin Bot..."
    nohup npx tsx src/index.ts >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Bot started (PID: $(cat "$PID_FILE"))"
    echo "Logs: tail -f $LOG_FILE"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Bot is not running (no PID file)"
        return 1
    fi

    PID=$(cat "$PID_FILE")
    if ! ps -p "$PID" > /dev/null 2>&1; then
        echo "Bot is not running (stale PID)"
        rm "$PID_FILE"
        return 1
    fi

    echo "Stopping bot (PID: $PID)..."
    kill "$PID"
    rm "$PID_FILE"
    echo "Bot stopped"
}

restart() {
    echo "Restarting bot..."
    stop
    sleep 2
    start
}

status() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Status: Not running"
        return 1
    fi

    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Status: Running (PID: $PID)"
        echo "Logs: tail -f $LOG_FILE"
        echo "API: http://localhost:3000"
        return 0
    else
        echo "Status: Not running (stale PID)"
        rm "$PID_FILE"
        return 1
    fi
}

logs() {
    tail -f "$LOG_FILE"
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the bot in background"
        echo "  stop    - Stop the running bot"
        echo "  restart - Restart the bot"
        echo "  status  - Check if bot is running"
        echo "  logs    - Follow bot logs (Ctrl+C to exit)"
        exit 1
        ;;
esac
