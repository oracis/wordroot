// WordRoot 匿名聚合上报接收端（骨架）
//
// 设计原则（与扩展端一致）：
//   - 只收「纯计数」：date/id/v/各功能次数。不接收单词内容、不读取客户端 IP、无法识别个人。
//   - 内存聚合 + 日志。生产环境请把 byDate 换成数据库（SQLite/Postgres 均可），并加按 id 的按天去重。
//   - 可选共享密钥校验：扩展端把 token 放在 ?t= 或 header x-wr-token；服务端读取两者之一。
//
// 运行：
//   go run main.go            # 默认 :8080
//   PORT=9000 WR_TOKEN=xxx go run main.go
//
// 接口：
//   POST /report   扩展端每日上报（body 为 JSON）
//   GET  /summary  查看按日期聚合的计数（调试用，生产应加鉴权或移除）
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
)

// Report 必须与扩展端 license.js 的 payload 字段一致
type Report struct {
	V         string `json:"v"`
	Date      string `json:"date"`
	ID        string `json:"id"` // 匿名设备 id，仅用于按天去重
	Lookups   int    `json:"lookups"`
	LLM       int    `json:"llm"`
	PDF       int    `json:"pdf"`
	EPUB      int    `json:"epub"`
	Exports   int    `json:"exports"`
	VocabAdds int    `json:"vocabAdds"`
}

var (
	mu     sync.Mutex
	byDate = map[string]map[string]int{} // date -> metric -> total
)

func wantToken() string { return os.Getenv("WR_TOKEN") }

func readToken(r *http.Request) string {
	if t := r.Header.Get("x-wr-token"); t != "" {
		return t
	}
	return r.URL.Query().Get("t")
}

func handleReport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if want := wantToken(); want != "" && readToken(r) != want {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var rep Report
	if err := json.NewDecoder(r.Body).Decode(&rep); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	// 隐私：明确不读取 r.RemoteAddr，也不写日志里的 IP。
	mu.Lock()
	if byDate[rep.Date] == nil {
		byDate[rep.Date] = map[string]int{}
	}
	d := byDate[rep.Date]
	d["lookups"] += rep.Lookups
	d["llm"] += rep.LLM
	d["pdf"] += rep.PDF
	d["epub"] += rep.EPUB
	d["exports"] += rep.Exports
	d["vocabAdds"] += rep.VocabAdds
	devices := 0
	if rep.ID != "" {
		devices++ // 骨架不持久化 id 集合；生产可用 SET/布隆过滤器算日活设备
	}
	mu.Unlock()

	log.Printf("report date=%s id=%s v=%s lookups=%d llm=%d pdf=%d epub=%d exports=%d vocab=%d (devices_seen=%d)",
		rep.Date, rep.ID, rep.V, rep.Lookups, rep.LLM, rep.PDF, rep.EPUB, rep.Exports, rep.VocabAdds, devices)
	w.WriteHeader(http.StatusNoContent)
}

func handleSummary(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(byDate)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/report", handleReport)
	http.HandleFunc("/summary", handleSummary)
	log.Printf("wordroot analytics listening on :%s (token=%v)", port, wantToken() != "")
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
