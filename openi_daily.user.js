// ==UserScript==
// @name         openi每日任务
// @namespace    https://bbs.tampermonkey.net.cn/
// @version      0.2.3
// @description  自动完成每日调试任务和commit任务，需要确保当前调试任务数量<=4，创建->停止->删除，需要到脚本内部设置program_path确定仓库的位置
// @author       Tiosa
// @license      MIT
// @crontab      * 0-23 once * *
// @connect      openi.pcl.ac.cn
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_log
// ==/UserScript==



const site = "https://openi.pcl.ac.cn";
const create_path = "/api/v1/-/-/ai_task/create"
const stop_path = "/api/v1/ai_task/stop";
const del_path = "/api/v1/ai_task/del";

const program_path = "Tiosa/test";
const branch_name = "master";
const commit_file_path = "README.md";
const repo_path = "/" + program_path + "/_edit/" + branch_name + "/" + commit_file_path;

const notify_tag = "openi-daily-task";

const del_retry_ms = 5000;
const del_max_retries = 15;

const commit_times = 3;
const commit_dalay = 5000;

let commit_count = 0;
let is_created = false;
let finish_status = {
    commit_finish_count: 0,
    commit_fail_count: 0,
    task_finish_count: 0,
    task_fail_count: 0
};
function parseHtmlInputs(htmlString) {
    // 创建临时 DOM 容器
    const tempDiv = document.createElement('div');
    // 把 HTML 字符串插入临时容器（浏览器自动解析成 DOM 节点）
    tempDiv.innerHTML = htmlString;

    // 获取所有 input 元素
    const inputElements = tempDiv.querySelectorAll('input');

    // 转成数组，方便处理
    return Array.from(inputElements).map(input => {
        return {
            element: input,        // 原生 DOM 元素
            type: input.type,      // 类型：text/password/checkbox等
            name: input.name,      // name 属性
            id: input.id,          // id 属性
            value: input.value,    // value 值
            checked: input.checked,// 单选/复选是否选中
            // 提取所有自定义属性
            attributes: Array.from(input.attributes).reduce((attrs, attr) => {
                attrs[attr.name] = attr.value;
                return attrs;
            }, {})
        };
    });
}

return new Promise((resolve, reject) => {
    const notifyStatus = (text, title = "openi每日任务") => {
        GM_notification({
            title,
            text,
            tag: notify_tag
        });
    };
    const commitTask = () => {
        commit_count++;
        GM_log("正在执行第" + commit_count.toString() + "次commit");
        GM_xmlhttpRequest({
            method: "GET",
            url: site + repo_path,
            onload: res => {
                let inputs = parseHtmlInputs(res.responseText);
                let reqData = {
                    _csrf: null,
                    last_commit: null,
                    tree_path: null,
                    new_branch_name: null,
                    content: "test" + Math.random().toString(),
                    commit_summary: "",
                    commit_message: "",
                    commit_choice: "direct"
                };

                inputs.forEach(e => {
                    switch (e.name) {
                        case "_csrf":
                            reqData._csrf = e.value;
                            start_task(e.value);
                            break;
                        case "last_commit":
                            reqData.last_commit = e.value;
                            break;
                        case "tree_path":
                            reqData.tree_path = e.value;
                            break;
                        case "new_branch_name":
                            reqData.new_branch_name = e.value;
                            break;
                        default:
                            break;
                    }
                });
                if (reqData._csrf !== null && reqData.last_commit !== null && reqData.tree_path !== null && reqData.new_branch_name !== null) {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: site + repo_path,
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        data: new URLSearchParams(reqData).toString(),
                        onload: res => {
                            // GM_log(res.responseText);
                            finish_status.commit_finish_count += 1;
                        }
                    })
                }
                else {
                    finish_status.commit_fail_count += 1;
                }
            }
        });
        if (commit_count < commit_times) {
            setTimeout(() => {
                commitTask();
            }, commit_dalay);
        }
        else {
            GM_log("已执行完" + commit_times.toString() + "次commit");
        }
    };
    const requestDel = (id, csrf, retryCount = 0) => {
        GM_xmlhttpRequest({
            method: "POST",
            url: site + del_path + "?id=" + id + "&_csrf=" + csrf,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ "_csrf": csrf }),
            onload: res => {
                let delData = null;
                try {
                    delData = JSON.parse(res.responseText);
                }
                catch (e) {
                    delData = null;
                }

                if (delData && delData.code === 99) {
                    if (retryCount >= del_max_retries) {
                        GM_log(res.responseText);
                        notifyStatus("删除超时");
                        finish_status.task_fail_count += 1;
                        return;
                    }
                    GM_log("删除返回99，任务未完全停止，等待后重试 del");
                    //notifyStatus(`任务未完全停止，${del_retry_ms / 1000}秒后重试删除(${retryCount + 1}/${del_max_retries})`);
                    setTimeout(() => {
                        requestDel(id, csrf, retryCount + 1);
                    }, del_retry_ms);
                    return;
                }

                if (res.responseText.includes("ok")) {
                    notifyStatus("删除成功");
                    finish_status.task_finish_count += 1;
                }
                else {
                    GM_log(res.responseText);
                    notifyStatus("删除失败");
                    finish_status.task_fail_count += 1;
                }
            }
        });
    };
    const start_task = (csrf) => {
        if (is_created) return;
        is_created = true;
        GM_xmlhttpRequest({
            method: "POST",
            url: site + create_path + "?_csrf=" + csrf,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                "repoOwnerName": "-",
                "repoName": "-",
                "job_type": "DEBUG",
                "cluster": "C2Net",
                "compute_source": "BIREN-GPU",
                "display_job_name": "test_task",
                "description": "", "branch_name": "",
                "pretrain_model_id_str": "",
                "image_url": "10.121.11.10:30013/default-workspace/38b54f1590294ec3a0892429f2670d3a/image:birensupa-smartinfer-25-10-rc1-vllm-090",
                "image_id": "66b4f24d0c444c9d95c95a1cec95b34d",
                "dataset_uuid_str": "",
                "has_internet": 2,
                "spec_id": 347,
                "_csrf": csrf
            }),
            onload: res => {
                GM_log("创建任务");
                if (!res.responseText.includes("Invalid")) {
                    const data = JSON.parse(res.responseText);
                    const id = data.data.id;
                    GM_log(id)
                    notifyStatus("创建成功，准备停止任务");
                    setTimeout(() => {
                        requestStopUntilReady(id, csrf);
                    }, 2000);

                }
                else {
                    GM_log("创建任务失败:csrf错误");
                    notifyStatus("创建失败：csrf错误");
                }

            }
        });
    };

    const requestStopUntilReady = (id, csrf) => {
        GM_xmlhttpRequest({
            method: "POST",
            url: site + stop_path + "?id=" + id + "&_csrf=" + csrf,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ "_csrf": csrf }),
            onload: res => {
                if (res.responseText.includes("ok")) {
                    GM_log("停止任务成功，开始删除任务");
                    notifyStatus("停止成功，开始删除任务");
                    requestDel(id, csrf);
                }
                else {
                    GM_log(res.responseText);
                    notifyStatus("停止失败");
                    finish_status.task_fail_count += 1;
                }
            }
        });
    };
    const monitor = () => {
        setTimeout(() => {
            if (finish_status.commit_fail_count + finish_status.commit_finish_count == commit_times && finish_status.task_finish_count + finish_status.task_fail_count == 1) {
                notifyStatus(
                    "概况：commit成功数：" + finish_status.commit_finish_count.toString()
                    + "，失败数：" + finish_status.commit_fail_count.toString()
                    + "\n调试任务：" + (finish_status.task_finish_count == 1 ? "运行成功" : "运行出错"),
                    "openi每日任务结束"
                );
                resolve("运行结束");
            }
            else {
                monitor();
            }
        }, 1000);
    }

    notifyStatus("开始执行每日任务");
    GM_xmlhttpRequest({
        method: "GET",
        url: site,
        onload: () => GM_log("请求网站")
    });
    commitTask();
    monitor();
});