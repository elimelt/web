import json


def test_chat_broadcast_between_two_clients_same_channel(client):
    headers1 = {"x-forwarded-for": "198.51.100.1"}
    headers2 = {"x-forwarded-for": "198.51.100.2"}

    with (
        client.websocket_connect("/ws/chat/general", headers=headers1) as ws1,
        client.websocket_connect("/ws/chat/general", headers=headers2) as ws2,
    ):
        ws1.send_text(json.dumps({"text": "hello world"}))

        msg2 = ws2.receive_text()
        event2 = json.loads(msg2)
        assert event2["type"] == "chat_message"
        assert event2["channel"] == "general"
        assert event2["text"] == "hello world"
        assert "sender" in event2
        assert "timestamp" in event2
