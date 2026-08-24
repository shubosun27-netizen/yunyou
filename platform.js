//1充值2微端3防沉迷4收藏
function apiOpenWindowsUrl(user_id, serverid, type) {
	if (type == 1) {
		window.open("");
	}
	else if (type == 2) {
		window.open("")
	}
	else if (type == 3) {
		window.open("")
	}
	else if (type == 4) {
		return window.open("")
	}
	return true
}


function pushConnectedTimeOut(username, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=8"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});
}

function pushServerInfo(username, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=6"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});
}
function pushServerInfo2(username, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=7"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});
}
function pushConnected(username, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=4"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});
}


function ConnectError(username, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=3"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});
}

function apiCreateRoleBtnClick(username, roleid, time, platform, roleName, sex, career, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=2"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});

}
function apiEnterCreateRoleView(username, roleid, time, platform, serverid) {
	var url = "https://ht-api.yscq-wy.yscq.com//kingapi/click.php?serverid=" + serverid + "&loginname=" + username + "&platform=" + platform + "&state=1"
	jQuery.support.cors = true; //$ajax({}) 正常写
	$.ajax({
		type: "GET",
		dataType: "JSON",
		url: url,
		success: function (data) {
		},
		error: function () {
		}
	});

}

window.downloadFile = function (sUrl) {

	//iOS devices do not support downloading. We have to inform user about this.
	if (/(iP)/g.test(navigator.userAgent)) {
		alert('Your device does not support files downloading. Please try again in desktop browser.');
		return false;
	}

	//If in Chrome or Safari - download via virtual link click
	if (window.downloadFile.isChrome || window.downloadFile.isSafari) {
		//Creating new link node.
		var link = document.createElement('a');
		link.href = sUrl;

		if (link.download !== undefined) {
			//Set HTML5 download attribute. This will prevent file from opening if supported.
			var fileName = sUrl.substring(sUrl.lastIndexOf('/') + 1, sUrl.length);
			link.download = fileName;
		}

		//Dispatching click event.
		if (document.createEvent) {
			var e = document.createEvent('MouseEvents');
			e.initEvent('click', true, true);
			link.dispatchEvent(e);
			return true;
		}
	}

	// Force file download (whether supported by server).
	if (sUrl.indexOf('?') === -1) {
		sUrl += '?download';
	}

	window.open(sUrl, '_self');
	return true;
}

window.downloadFile.isChrome = navigator.userAgent.toLowerCase().indexOf('chrome') > -1;
window.downloadFile.isSafari = navigator.userAgent.toLowerCase().indexOf('safari') > -1;