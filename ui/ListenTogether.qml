import QtQuick

Rectangle {
    id: root
    color: "#121318"
    property var roomState: ({ initialized: false, inRoom: false, busy: false,
                               roomId: "", members: "", invitation: "",
                               statusText: "正在读取房间状态…", error: "" })
    property real responseWatch: plugin.revision

    function invoke(action, payload) {
        plugin.call(action, JSON.stringify(payload || {}))
    }
    function updateResponse() {
        if (plugin.resultJson && plugin.resultJson.length > 0) {
            try { root.roomState = JSON.parse(plugin.resultJson) }
            catch (_) { }
        }
    }
    onResponseWatchChanged: updateResponse()
    Component.onCompleted: invoke("status", {})

    Timer {
        interval: 1200
        running: true
        repeat: true
        onTriggered: if (!plugin.busy) root.invoke("status", {})
    }

    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 76
        color: "#1b1b21"

        Text {
            anchors.left: parent.left
            anchors.leftMargin: 26
            anchors.verticalCenter: parent.verticalCenter
            text: "一起听"
            color: "#f3f0f8"
            font.pixelSize: 24
            font.bold: true
        }
        Text {
            anchors.right: parent.right
            anchors.rightMargin: 26
            anchors.verticalCenter: parent.verticalCenter
            text: plugin.busy ? "同步中…" : "网易云音乐"
            color: plugin.busy ? "#d0bcff" : "#c9c5d0"
            font.pixelSize: 14
        }
    }

    Item {
        anchors.top: header.bottom
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right

        Rectangle {
            id: card
            width: Math.min(parent.width - 32, 610)
            height: root.roomState.inRoom ? 390 : 410
            anchors.centerIn: parent
            radius: 24
            color: "#202127"
            border.width: 1
            border.color: "#46464f"

            Text {
                id: statusIcon
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 30
                text: root.roomState.inRoom ? "♫" : "♪"
                color: "#d0bcff"
                font.pixelSize: 42
            }
            Text {
                id: statusTitle
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: statusIcon.bottom
                anchors.topMargin: 8
                width: parent.width - 48
                horizontalAlignment: Text.AlignHCenter
                text: root.roomState.statusText || "尚未加入房间"
                color: "#f3f0f8"
                font.pixelSize: 20
                font.bold: true
                wrapMode: Text.WordWrap
            }
            Text {
                id: memberText
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: statusTitle.bottom
                anchors.topMargin: 8
                width: parent.width - 48
                horizontalAlignment: Text.AlignHCenter
                text: root.roomState.inRoom
                      ? (root.roomState.members || ("房间 " + root.roomState.roomId))
                      : "创建房间，或粘贴好友发来的邀请链接"
                color: "#c9c5d0"
                font.pixelSize: 14
                wrapMode: Text.WordWrap
            }

            Item {
                id: joinArea
                visible: !root.roomState.inRoom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: memberText.bottom
                anchors.topMargin: 26
                height: 170

                Rectangle {
                    id: inputOutline
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.leftMargin: 24
                    anchors.rightMargin: 24
                    height: 58
                    radius: 14
                    color: "#1a1b20"
                    border.width: 1
                    border.color: invitationInput.activeFocus ? "#d0bcff" : "#75747e"
                    TextInput {
                        id: invitationInput
                        anchors.fill: parent
                        anchors.leftMargin: 16
                        anchors.rightMargin: 16
                        verticalAlignment: TextInput.AlignVCenter
                        color: "#f3f0f8"
                        selectionColor: "#67508f"
                        font.pixelSize: 15
                        clip: true
                    }
                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 16
                        anchors.verticalCenter: parent.verticalCenter
                        visible: invitationInput.text.length === 0
                        text: "邀请链接或房间 ID"
                        color: "#92909a"
                        font.pixelSize: 15
                    }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: invitationInput.forceActiveFocus()
                    }
                }

                Rectangle {
                    id: createButton
                    anchors.left: parent.left
                    anchors.leftMargin: 24
                    anchors.top: inputOutline.bottom
                    anchors.topMargin: 18
                    width: (parent.width - 60) / 2
                    height: 50
                    radius: 25
                    color: createMouse.pressed ? "#b59de8" : "#d0bcff"
                    opacity: plugin.busy ? 0.5 : 1
                    Text { anchors.centerIn: parent; text: "创建房间"; color: "#381e72"; font.pixelSize: 15; font.bold: true }
                    MouseArea { id: createMouse; anchors.fill: parent; enabled: !plugin.busy; onClicked: root.invoke("create", {}) }
                }
                Rectangle {
                    anchors.right: parent.right
                    anchors.rightMargin: 24
                    anchors.top: inputOutline.bottom
                    anchors.topMargin: 18
                    width: (parent.width - 60) / 2
                    height: 50
                    radius: 25
                    color: joinMouse.pressed ? "#34343d" : "#292a31"
                    border.width: 1
                    border.color: "#938f99"
                    opacity: plugin.busy || invitationInput.text.length === 0 ? 0.5 : 1
                    Text { anchors.centerIn: parent; text: "加入房间"; color: "#d0bcff"; font.pixelSize: 15; font.bold: true }
                    MouseArea {
                        id: joinMouse
                        anchors.fill: parent
                        enabled: !plugin.busy && invitationInput.text.length > 0
                        onClicked: root.invoke("join", {invitation: invitationInput.text})
                    }
                }
            }

            Item {
                visible: root.roomState.inRoom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: memberText.bottom
                anchors.topMargin: 24
                height: 160

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.leftMargin: 24
                    anchors.rightMargin: 24
                    height: 62
                    radius: 14
                    color: "#1a1b20"
                    border.width: 1
                    border.color: "#46464f"
                    Text {
                        anchors.fill: parent
                        anchors.margins: 12
                        text: root.roomState.invitation
                        color: "#c9c5d0"
                        font.pixelSize: 12
                        wrapMode: Text.WrapAnywhere
                        verticalAlignment: Text.AlignVCenter
                    }
                }
                Rectangle {
                    id: copyButton
                    anchors.left: parent.left
                    anchors.leftMargin: 24
                    anchors.bottom: parent.bottom
                    width: (parent.width - 60) / 2
                    height: 50
                    radius: 25
                    color: copyMouse.pressed ? "#b59de8" : "#d0bcff"
                    opacity: plugin.busy ? 0.5 : 1
                    Text { anchors.centerIn: parent; text: "复制邀请"; color: "#381e72"; font.pixelSize: 15; font.bold: true }
                    MouseArea { id: copyMouse; anchors.fill: parent; enabled: !plugin.busy; onClicked: root.invoke("copy", {}) }
                }
                Rectangle {
                    anchors.right: parent.right
                    anchors.rightMargin: 24
                    anchors.bottom: parent.bottom
                    width: (parent.width - 60) / 2
                    height: 50
                    radius: 25
                    color: leaveMouse.pressed ? "#412b2d" : "transparent"
                    border.width: 1
                    border.color: "#ffb4ab"
                    opacity: plugin.busy ? 0.5 : 1
                    Text { anchors.centerIn: parent; text: "退出房间"; color: "#ffb4ab"; font.pixelSize: 15; font.bold: true }
                    MouseArea { id: leaveMouse; anchors.fill: parent; enabled: !plugin.busy; onClicked: root.invoke("leave", {}) }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.leftMargin: 24
                anchors.rightMargin: 24
                anchors.bottomMargin: 18
                visible: (root.roomState.error && root.roomState.error.length > 0)
                         || (plugin.error && plugin.error.length > 0)
                text: root.roomState.error || plugin.error
                color: "#ffb4ab"
                font.pixelSize: 13
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
            }
        }
    }
}
