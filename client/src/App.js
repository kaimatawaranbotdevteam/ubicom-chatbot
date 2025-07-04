import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import './index.css';
import { LuSend } from "react-icons/lu";

export default function App() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]); // scrolls on message update

  const handleSearch = async () => {
    if (!query.trim()) return;

    const newMessage = {
      role: "user",
      content: query
    };

    // Construct the new messages list manually
    const updatedMessages = [...messages, newMessage];
    setQuery(""); // Clear input
    // Update the state for UI
    setMessages(updatedMessages);

    try {
      axios.post('https://ubicom-chatbot-web-app.azurewebsites.net/api/query', { messages: updatedMessages })
        .then(res => {

        const responseMessages = {
        role: "system",
        content: res.data.reply
      };

      setMessages((prev) => [
        ...prev, responseMessages]);

      })
      .catch(error => {
        console.error('Error:', error);
      });
    } catch (error) {
      console.error("Fetch failed:", error);
      alert("Network error. Please check your server.");
    }
  };


  return (
  <div className="flex items-center justify-center min-h-screen bg-gray-100">
  {/* Top-right icon */}
  <div className="absolute left-0 flex items-start justify-between w-full px-12 py-6 top-8">
    <div><span className="text-4xl text-gray-400">Smart Assistant</span>
    </div>
    <div><img src="assets/Bulb.png" alt="Logo" className="h-12 w-60" />
    </div>
  </div>

  {/* Outer container takes 3/4 of the screen width */}
  <div className="w-11/12 p-3 bg-white border border-black rounded-lg shadow-md">

  {/* Chat messages area */}
  <div className="flex flex-col h-[70vh] overflow-y-auto">
    {messages.map((msg, index) => {

      const isUser = msg.role === "user";

      const bubble = isUser ? "self-start p-3 mt-2 mr-3 rounded-xl bg-gray-300 text-slate shadow-md" : "self-start p-3 mt-2 mr-3 rounded-xl bg-gray-400 text-white shadow-md";
      // <div key={index} className="flex flex-col mb-2"className="flex flex-col mb-2">
      return (
        <div key={index} className={`${bubble}`} >
              {msg.content}
        </div>
      )
    })}
    <div ref={bottomRef} /> {/* anchor to scroll to */}
    </div>

    {/* Input area */}
    <div className="flex mt-4">
      <input
        className="flex-1 p-2 border rounded-l border-slate-400"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); // prevent new line (optional for textareas)
            handleSearch();
          }
        }}
        placeholder="Type your question and press Enter or hit Send button..."
      />
      <LuSend className="w-10 h-10 ml-2" onClick={handleSearch}/>
    </div>

    </div>
  </div>

  )
}