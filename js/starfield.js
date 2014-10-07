document.body.style.margin = 0;
document.body.style.overflow = "hidden";
var canvas = document.body.children[0];
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
var context = canvas.getContext("2d");
context.globalAlpha = 0.3;
var p = 10, q = [], r = 0, V = 1000, W = 190, Q = 0.3;

var i = window.innerWidth;
var j = 30;
$(window).resize(function() {
	i = window.innerWidth;
	j = 30;
});

//function t(a) {
//	var f = 0;
//	if (a)
//		f = -a / 3;
//	if (f > 0 && s < 1 || f < 0 && s + f / 25 > 0.1)
//		s += f / 25
//}

function u(a) {
	a.x = (Math.random() * window.innerWidth - window.innerWidth * 0.5) * p;
	a.y = (Math.random() * window.innerHeight - window.innerHeight * 0.5) * p;
	a.a = p;
	a.b = 0;
	a.c = 0
}

for (var v = 0, w; v < V; v++) {
	w = {};
	u(w);
	q.push(w)
}

function stars() {
	context.fillStyle = "#000";
	context.fillRect(0, 0, window.innerWidth, window.innerHeight);
	for (var a = i - window.innerWidth / 2 + window.innerWidth / 2, f = j - window.innerHeight / 2 + window.innerHeight / 2, h = 0; h < V; h++) {
		var b = q[h], x = b.x / b.a, y = b.y / b.a, z = 1 / b.a * 5 + 1, A = Math.sin(Q * h + r) * 64 + W, B = Math.sin(Q * h + 2 + r) * 64 + W, C = Math.sin(Q * h + 4 + r) * 64 + W;
		if (b.b != 0) {
			context.strokeStyle = "rgb(" + Math.floor(A) + "," + Math.floor(B) + "," + Math.floor(C) + ")";
			context.lineWidth = z;
			context.beginPath();
			context.moveTo(x + a, y + f);
			context.lineTo(b.b + a, b.c + f);
			context.stroke()
		}
		b.b = x;
		b.c = y;
		b.a -= Game.s || 0.005;

		if (b.a < Game.s || b.b > window.innerWidth || b.c > window.innerHeight) u(b)
	}
	r += 0.1;
}

setInterval(stars, 25);